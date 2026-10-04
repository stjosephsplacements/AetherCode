"""End-to-end smoke test of the platform through the gateway.

Run on the server after an upgrade:

    python3 smoke.py [admin-credentials-file] [gateway-url]

The credentials file holds "<email> <password>" (setup writes
~/aethercode-admin.txt). Every run uses fresh names, so it can be repeated;
it leaves its test college data behind. Exits non-zero on the first failure.
"""
import base64, json, os, sys, time, urllib.request, urllib.error, uuid

CREDENTIALS = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser("~/aethercode-admin.txt")
BASE = (sys.argv[2] if len(sys.argv) > 2 else "http://127.0.0.1:8380") + "/api"
admin_email, admin_password = open(CREDENTIALS).read().split()[:2]
run = uuid.uuid4().hex[:6]

def call(method, path, body=None, token=None, expect=None, retries=5):
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(BASE + path, data=data, method=method)
    request.add_header("Content-Type", "application/json")
    if method != "GET":
        request.add_header("Idempotency-Key", str(uuid.uuid4()))
    if token:
        request.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            status, raw, headers = response.status, response.read(), response.headers
    except urllib.error.HTTPError as error:
        status, raw, headers = error.code, error.read(), error.headers
    try:
        payload = json.loads(raw) if raw else None
    except ValueError:
        payload = raw.decode(errors="replace")
    if status == 503 and retries > 0:
        # Permissions or projections still settling; a real client retries.
        time.sleep(float(headers.get("Retry-After", "2")))
        return call(method, path, body, token, expect, retries - 1)
    if expect is not None and status != expect:
        sys.exit(f"FAIL {method} {path}: HTTP {status} {payload}")
    return status, payload, headers

def login(identifier, password, expect=200):
    status, payload, _ = call("POST", "/identity/v1/auth/login", {"identifier": identifier, "password": password}, expect=expect)
    return payload["access_token"] if status == 200 else None

def ok(message):
    print("PASS", message)

admin = login(admin_email, admin_password)
ok("admin signs in by email via identifier")
_, tenants, _ = call("GET", "/tenant/v1/tenants", token=admin, expect=200)
tenant = tenants["items"][0]["id"]
_, departments, _ = call("GET", f"/tenant/v1/tenants/{tenant}/departments", token=admin, expect=200)
department = departments["items"][0]["id"]
_, organization, _ = call("POST", "/tenant/v1/placement-organizations", {"code": f"PC{run}".upper(), "legal_name": f"Placement Cell {run}"}, token=admin, expect=201)
_, placement, _ = call("POST", f"/tenant/v1/placement-organizations/{organization['id']}/departments", {"code": "TPO", "name": "Training and Placement"}, token=admin, expect=201)
_, batch, _ = call("POST", f"/tenant/v1/tenants/{tenant}/batches", {"department_id": department, "code": f"A{run}".upper(), "name": "CSE A", "academic_year": "2026-2027"}, token=admin, expect=201)
ok("placement department and batch created")
time.sleep(5)  # tenant projections reach the user service over NATS

roll = lambda n: f"S{run}{n:03d}".upper()
target = {"batch_id": batch["id"], "college_department_id": department, "placement_department_id": placement["id"]}
status, bad, _ = call("POST", f"/user/v1/tenants/{tenant}/students/import", {**target, "students": [{"roll_number": roll(1), "name": "Asha"}, {"roll_number": "21/CS/9", "name": "Bad"}]}, token=admin)
assert status == 400 and "row 2" in bad["message"], (status, bad)
ok(f"invalid row rejects the file: {bad['message']}")

status, result, headers = call("POST", f"/user/v1/tenants/{tenant}/students/import", {**target, "students": [{"roll_number": roll(n), "name": f"Student {n}"} for n in (1, 2, 3)]}, token=admin, expect=201)
assert len(result["imported"]) == 3 and headers["Cache-Control"] == "no-store", result
ok("3 students imported with one-time passwords (no-store)")
_, again, _ = call("POST", f"/user/v1/tenants/{tenant}/students/import", {**target, "students": [{"roll_number": roll(3), "name": "Student 3"}, {"roll_number": roll(4), "name": "Student 4"}]}, token=admin, expect=201)
assert again["skipped"] == [roll(3)] and len(again["imported"]) == 1, again
ok("re-import skips existing roll number, adds the new one")

first = result["imported"][0]
student = login(first["roll_number"], first["password"])
ok(f"student signs in by roll number {first['roll_number']} (case-insensitive)")

call("GET", f"/identity/v1/principals/{first['principal_id']}", token=student, expect=200)
admin_id = json.loads(base64.urlsafe_b64decode(admin.split(".")[1] + "=="))["sub"]
for method in ("GET", "DELETE"):
    status, _, _ = call(method, f"/identity/v1/principals/{admin_id}", {"reason": "x"} if method == "DELETE" else None, token=student)
    assert status == 403, (method, status)
status, _, _ = call("DELETE", f"/identity/v1/principals/{admin_id}/hard", {"reason": "x"}, token=student)
assert status in (404, 405), status
ok("student cannot read, delete, or hard-delete the admin")
status, _, _ = call("POST", f"/user/v1/tenants/{tenant}/students/import", {**target, "students": [{"roll_number": roll(9), "name": "X"}]}, token=student)
assert status == 403, status
ok("student cannot import accounts")

_, reissued, _ = call("POST", f"/user/v1/tenants/{tenant}/batches/{batch['id']}/passwords", token=admin, expect=200)
assert len(reissued["accounts"]) == 4 and all(a["display_name"] and a["username"] for a in reissued["accounts"]), reissued
login(first["roll_number"], first["password"], expect=401)
new_password = next(a["password"] for a in reissued["accounts"] if a["principal_id"] == first["principal_id"])
login(first["roll_number"], new_password)
ok("batch reissue: 4 new passwords with names, old password rejected, new works")

call("PUT", f"/user/v1/tenants/{tenant}/accounts/{first['principal_id']}/status", {"status": "disabled"}, token=admin, expect=204)
login(first["roll_number"], new_password, expect=401)
call("PUT", f"/user/v1/tenants/{tenant}/accounts/{first['principal_id']}/status", {"status": "active"}, token=admin, expect=204)
login(first["roll_number"], new_password)
ok("disable blocks sign-in, enable restores it")

_, reset, _ = call("POST", f"/user/v1/tenants/{tenant}/accounts/{first['principal_id']}/password", token=admin, expect=200)
login(first["roll_number"], reset["password"])
ok("single password reset works")
status, _, _ = call("POST", f"/user/v1/tenants/{tenant}/accounts/{admin_id}/password", token=admin)
assert status == 404, status
ok("college cannot reset the platform admin's password (404)")

_, staff, _ = call("POST", f"/user/v1/tenants/{tenant}/staff", {"username": f"faculty.{run}", "display_name": "Faculty One", "role": "department_user", "department_id": department}, token=admin, expect=201)
login(f"faculty.{run}", staff["password"])
ok(f"faculty account created ({staff['role_assignment']['scope_kind']} scope) and signs in")
print("ALL M1 CHECKS PASSED")

# --- M2: authoring --------------------------------------------------------
faculty = login(f"faculty.{run}", staff["password"])
student = login(first["roll_number"], reset["password"])  # earlier tokens were revoked by the reissue
question_body = {
    "slug": f"sum-{run}", "title": "Sum two numbers", "prompt_markdown": "Print a + b.",
    "difficulty": "easy", "supported_languages": ["c", "python3"],
    "time_limit_ms": 2000, "memory_limit_kib": 262144, "tags": [],
}
status, _, _ = call("POST", "/question-bank/v1/questions", question_body, token=student)
assert status == 403, status
ok("a student cannot author questions")
_, question, _ = call("POST", "/question-bank/v1/questions", question_body, token=faculty, expect=201)
version_id = question["question_version"]["id"]
ok("faculty authors into the global question bank")
tests = [
    {"input": "1 2\n", "expected_output": "3\n", "sample": True},
    {"input": "5 7\n", "expected_output": "12\n", "sample": True, "weight": 2},
    {"input": "100 200\n", "expected_output": "300\n", "sample": False, "weight": 3},
    {"input": "-4 4\n", "expected_output": "0\n", "sample": False},
]
status, _, _ = call("PUT", f"/question-bank/v1/question-versions/{version_id}/tests",
                    {"expected_question_version": 1, "tests": [t for t in tests if t["sample"]]}, token=faculty)
assert status == 400, status
_, version, _ = call("PUT", f"/question-bank/v1/question-versions/{version_id}/tests",
                     {"expected_question_version": 1, "tests": tests}, token=faculty, expect=200)
assert version["sample_test_case_count"] == 2 and version["hidden_test_case_count"] == 2, version
assert "input" not in json.dumps(version) and "expected_output" not in json.dumps(version), version
ok("plaintext tests become encrypted bundles; the response shows counts only")
status, _, _ = call("GET", f"/question-bank/v1/question-versions/{version_id}/bundle", token=faculty)
assert status in (404, 405), status
ok("the hidden-test download endpoint is gone")
call("POST", f"/question-bank/v1/question-versions/{version_id}/publish",
     {"expected_question_version": version["version"]}, token=faculty, expect=200)
ok("question published")

_, policy, _ = call("POST", f"/assessment/v1/tenants/{tenant}/proctor-policies", {"name": f"Lab {run}"}, token=faculty, expect=201)
_, policy_version, _ = call("POST", f"/assessment/v1/tenants/{tenant}/proctor-policies/{policy['id']}/versions",
                           {"expected_policy_version": policy["version"], "policy": {"seb_required": False}}, token=faculty, expect=201)
call("POST", f"/assessment/v1/tenants/{tenant}/proctor-policy-versions/{policy_version['id']}/publish", {}, token=faculty, expect=200)
_, exam, _ = call("POST", f"/assessment/v1/tenants/{tenant}/exams", {"external_reference": f"smoke-{run}"}, token=faculty, expect=201)
now = time.time()
iso = lambda seconds: time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(seconds))
_, exam_version, _ = call("POST", f"/assessment/v1/tenants/{tenant}/exams/{exam['id']}/versions", {
    "expected_exam_version": exam["version"], "title": "Smoke test", "instructions_markdown": "Solve it.",
    "opens_at": iso(now + 120), "closes_at": iso(now + 7200), "duration_seconds": 3600,
    "proctor_policy_version_id": policy_version["id"]}, token=faculty, expect=201)
content = lambda: call("GET", f"/assessment/v1/tenants/{tenant}/exam-versions/{exam_version['id']}", token=faculty, expect=200)[1]["content_version"]
versions_path = f"/assessment/v1/tenants/{tenant}/exam-versions/{exam_version['id']}"
_, section, _ = call("POST", f"{versions_path}/sections", {"expected_content_version": content(), "position": 1,
                     "title": "Coding", "instructions_markdown": "", "time_limit_seconds": None}, token=faculty, expect=201)
status, _, _ = call("POST", f"{versions_path}/sections/{section['id']}/items", {"expected_content_version": content(), "position": 1,
                    "question_version_id": str(uuid.uuid4()), "maximum_score": "10"}, token=faculty)
assert status == 404, status
ok("an unknown or unpublished question cannot be added to an exam")
_, item, _ = call("POST", f"{versions_path}/sections/{section['id']}/items", {"expected_content_version": content(), "position": 1,
                  "question_version_id": version_id, "maximum_score": "10"}, token=faculty, expect=201)
assert item["question_version_id"] == version_id and len(item["evaluation_bundle_checksum"]) == 64, item
ok("exam item pins the published question's bundles, resolved from the bank over mTLS")
call("POST", f"{versions_path}/publish", {"expected_content_version": content()}, token=faculty, expect=200)
call("POST", f"{versions_path}/assignment-rules", {"target_type": "batch", "target_id": batch["id"],
     "available_from": exam_version["opens_at"], "available_until": exam_version["closes_at"], "accommodations": {}},
     token=faculty, expect=201)
ok("exam published and assigned to the batch")
for _ in range(15):
    _, mine, _ = call("GET", f"/assessment/v1/tenants/{tenant}/candidate-assignments", token=student, expect=200)
    if any(a.get("exam_version_id") == exam_version["id"] for a in mine["items"]):
        break
    time.sleep(2)
else:
    sys.exit(f"FAIL the batch's student never received the exam: {mine}")
ok("a student in the batch sees the assigned exam")
print("ALL M2 CHECKS PASSED")
