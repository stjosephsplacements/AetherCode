"""End-to-end smoke test of the platform through the gateway.

Run on the server after an upgrade:

    python3 smoke.py [admin-credentials-file] [gateway-url] [public-origin]

The credentials file holds "<email> <password>" (setup writes
~/aethercode-admin.txt). Every run uses fresh names, so it can be repeated;
it leaves its test college data behind. Exits non-zero on the first failure.
The public origin is what Safe Exam Browser hashes request URLs with; it must
match the gateway's GATEWAY_SEB_PUBLIC_ORIGIN.
"""
import base64, gzip, hashlib, json, os, sys, time, urllib.request, urllib.error, uuid

CREDENTIALS = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser("~/aethercode-admin.txt")
BASE = (sys.argv[2] if len(sys.argv) > 2 else "http://127.0.0.1:8380") + "/api"
PUBLIC_ORIGIN = sys.argv[3] if len(sys.argv) > 3 else "https://aethercode.stjosephsplacements.in"
admin_email, admin_password = open(CREDENTIALS).read().split()[:2]
run = uuid.uuid4().hex[:6]

def call(method, path, body=None, token=None, expect=None, retries=5, headers=None):
    request_headers = headers
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(BASE + path, data=data, method=method)
    request.add_header("Content-Type", "application/json")
    for name, value in (headers or {}).items():
        request.add_header(name, value)
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
        payload = raw  # binary, such as a .seb launch file
    if status == 503 and retries > 0:
        # Permissions or projections still settling; a real client retries.
        time.sleep(float(headers.get("Retry-After", "2")))
        return call(method, path, body, token, expect, retries - 1, request_headers)
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
iso = lambda seconds: time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(seconds))

def publish_exam(title, duration_seconds, check_unknown_question=False):
    """Publishes a one-question exam opening in 20 s, assigns it to the batch,
    and returns (opens_at epoch, exam version, item, the student's assignment)."""
    _, exam, _ = call("POST", f"/assessment/v1/tenants/{tenant}/exams", {"external_reference": f"{title}-{run}"}, token=faculty, expect=201)
    opens = time.time() + 20
    _, exam_version, _ = call("POST", f"/assessment/v1/tenants/{tenant}/exams/{exam['id']}/versions", {
        "expected_exam_version": exam["version"], "title": title, "instructions_markdown": "Solve it.",
        "opens_at": iso(opens), "closes_at": iso(opens + 7200), "duration_seconds": duration_seconds,
        "proctor_policy_version_id": policy_version["id"]}, token=faculty, expect=201)
    versions_path = f"/assessment/v1/tenants/{tenant}/exam-versions/{exam_version['id']}"
    content = lambda: call("GET", versions_path, token=faculty, expect=200)[1]["content_version"]
    _, section, _ = call("POST", f"{versions_path}/sections", {"expected_content_version": content(), "position": 1,
                         "title": "Coding", "instructions_markdown": "", "time_limit_seconds": None}, token=faculty, expect=201)
    if check_unknown_question:
        status, _, _ = call("POST", f"{versions_path}/sections/{section['id']}/items", {"expected_content_version": content(), "position": 1,
                            "question_version_id": str(uuid.uuid4()), "maximum_score": "10"}, token=faculty)
        assert status == 404, status
        ok("an unknown or unpublished question cannot be added to an exam")
    _, item, _ = call("POST", f"{versions_path}/sections/{section['id']}/items", {"expected_content_version": content(), "position": 1,
                      "question_version_id": version_id, "maximum_score": "10"}, token=faculty, expect=201)
    assert item["question_version_id"] == version_id and len(item["evaluation_bundle_checksum"]) == 64, item
    call("POST", f"{versions_path}/publish", {"expected_content_version": content()}, token=faculty, expect=200)
    call("POST", f"{versions_path}/assignment-rules", {"target_type": "batch", "target_id": batch["id"],
         "available_from": exam_version["opens_at"], "available_until": exam_version["closes_at"], "accommodations": {}},
         token=faculty, expect=201)
    for _ in range(15):
        _, mine, _ = call("GET", f"/assessment/v1/tenants/{tenant}/candidate-assignments", token=student, expect=200)
        found = [a for a in mine["items"] if a.get("exam_version_id") == exam_version["id"]]
        if found:
            return opens, exam_version, item, found[0]
        time.sleep(2)
    sys.exit(f"FAIL the batch's student never received the exam: {mine}")

opens, exam_version, item, assignment = publish_exam("Smoke test", 3600, check_unknown_question=True)
ok("exam item pins the published question's bundles, resolved from the bank over mTLS")
ok("exam published and assigned to the batch")
ok("a student in the batch sees the assigned exam")
print("ALL M2 CHECKS PASSED")

# --- M3: take and grade ---------------------------------------------------
time.sleep(max(0, opens + 2 - time.time()))
attempts = f"/submission/v1/tenants/{tenant}/attempts"
_, attempt, _ = call("POST", attempts, {"candidate_assignment_id": assignment["id"]}, token=student, expect=201)
ok("student starts the exam")
status, _, _ = call("PUT", f"{attempts}/{attempt['id']}/answers/{item['id']}",
                    {"language": "java", "source": "class Main {}", "expected_attempt_version": attempt["version"]}, token=student)
assert status == 400, status
ok("a language the question does not allow is rejected")
# Correct except for negative first operands: fails only the weight-1 hidden test.
source = "a, b = map(int, input().split())\nprint(a + b if a >= 0 else 1)\n"
_, revision, _ = call("PUT", f"{attempts}/{attempt['id']}/answers/{item['id']}",
                      {"language": "python3", "source": source, "expected_attempt_version": attempt["version"]}, token=student, expect=201)
assert "source_object_key" not in revision and "encryption_key_reference" not in revision, revision
ok("code saved; storage details stay server-side")

def run_code(code):
    _, started, _ = call("POST", f"{attempts}/{attempt['id']}/items/{item['id']}/runs",
                         {"language": "python3", "source": code}, token=student, expect=202)
    for _ in range(60):
        _, result, _ = call("GET", f"{attempts}/{attempt['id']}/runs/{started['id']}", token=student, expect=200)
        if result["lifecycle_state"] in ("completed", "failed"):
            return result
        time.sleep(1)
    sys.exit(f"FAIL the run never completed: {result}")

result = run_code(source)
units = result["units"]
assert len(units) == 2, result  # the two sample tests, never the hidden ones
assert [(u["stdin"], u["expected_output"], u["stdout"], u["verdict"]) for u in units] == [
    ("1 2\n", "3\n", "3\n", "accepted"), ("5 7\n", "12\n", "12\n", "accepted")], units
ok("Run executes the sample tests only and shows input, expected and actual output")
broken = run_code("print(\n")
assert broken["units"] and any((u["stderr"] or "") + (u["compile_output"] or "") for u in broken["units"]), broken
ok("a broken run shows the error output")
_, runs, _ = call("GET", f"{attempts}/{attempt['id']}/items/{item['id']}/runs", token=student, expect=200)
assert [r["id"] for r in runs["items"]] == [broken["id"], result["id"]] and runs["items"][1]["passed_units"] == 2, runs
ok("run history lists runs newest first")
call("POST", f"{attempts}/{attempt['id']}/submit", {"expected_attempt_version": revision["attempt_version"]}, token=student, expect=202)
for _ in range(60):
    _, attempt, _ = call("GET", f"{attempts}/{attempt['id']}", token=student, expect=200)
    if attempt["lifecycle_state"] == "graded":
        break
    time.sleep(2)
else:
    sys.exit(f"FAIL the attempt was never graded: {attempt}")
_, results, _ = call("GET", f"{attempts}/{attempt['id']}/unit-results", token=student, expect=200)
unit = results["items"][0]
assert (unit["passed_units"], unit["total_units"]) == (3, 4), results
ok("submission dispatched, judged by the engine, and graded: 3 of 4 tests passed")

# Time-up: a 60-second exam whose student saves code and never submits.
opens, timed_version, timed_item, timed_assignment = publish_exam("Timed smoke test", 60)
time.sleep(max(0, opens + 2 - time.time()))
_, timed, _ = call("POST", attempts, {"candidate_assignment_id": timed_assignment["id"]}, token=student, expect=201)
deadline_seconds = (time.mktime(time.strptime(timed["submission_deadline"][:19], "%Y-%m-%dT%H:%M:%S"))
                    - time.mktime(time.strptime(timed["started_at"][:19], "%Y-%m-%dT%H:%M:%S")))
assert 55 <= deadline_seconds <= 61, timed
ok("the deadline is start plus the exam's duration, not the window's close")
call("PUT", f"{attempts}/{timed['id']}/answers/{timed_item['id']}",
     {"language": "python3", "source": source, "expected_attempt_version": timed["version"]}, token=student, expect=201)
for _ in range(90):
    _, timed, _ = call("GET", f"{attempts}/{timed['id']}", token=student, expect=200)
    if timed["lifecycle_state"] == "graded":
        break
    time.sleep(2)
else:
    sys.exit(f"FAIL time-up never submitted the saved code: {timed}")
_, results, _ = call("GET", f"{attempts}/{timed['id']}/unit-results", token=student, expect=200)
assert (results["items"][0]["passed_units"], results["items"][0]["total_units"]) == (3, 4), results
ok("time-up submitted the saved code and it was graded: 3 of 4 tests passed")
print("ALL M3 CHECKS PASSED")

# --- M4: Safe Exam Browser ------------------------------------------------
def seb_headers(path, key):
    """What Safe Exam Browser sends: sha256(absolute URL + Browser Exam Key)."""
    url = PUBLIC_ORIGIN + "/api" + path
    return {"X-SafeExamBrowser-RequestHash": hashlib.sha256((url + key).encode()).hexdigest()}

opens, locked_version, locked_item, locked_assignment = publish_exam("Locked smoke test", 3600)
locked_exam = locked_version["exam_id"]
browser_exam_key = hashlib.sha256(run.encode()).hexdigest()
policy_path = f"/seb/v1/tenants/{tenant}/exams/{locked_exam}/seb-policy"
status, _, _ = call("PUT", policy_path, {"title": "Locked", "enabled": True, "accepted_keys": [browser_exam_key]}, token=student)
assert status == 403, status
ok("a student cannot lock or unlock an exam")
call("PUT", policy_path, {"title": "Locked smoke test", "enabled": True, "accepted_keys": [browser_exam_key.upper()]},
     token=faculty, expect=200)
_, policy, _ = call("GET", policy_path, token=faculty, expect=200)
assert policy["enabled"] and policy["accepted_keys"] == [browser_exam_key], policy
ok("faculty lock the exam to Safe Exam Browser with its Browser Exam Key")
_, launch, launch_headers = call("GET", f"/seb/v1/tenants/{tenant}/exams/{locked_exam}/launch-file", token=student, expect=200)
assert launch_headers["Content-Type"] == "application/seb" and launch_headers["Content-Encoding"] == "identity", dict(launch_headers)
assert launch_headers["Content-Disposition"] == 'attachment; filename="locked-smoke-test.seb"', dict(launch_headers)
assert gzip.decompress(launch)[:4] == b"pswd", launch[:16]
ok("the student downloads an encrypted .seb launch file")

time.sleep(max(0, opens + 2 - time.time()))
for _ in range(30):
    status, _, _ = call("GET", attempts, token=student)
    if status == 403:
        break
    time.sleep(2)
else:
    sys.exit(f"FAIL the open locked exam never required Safe Exam Browser: HTTP {status}")
ok("outside Safe Exam Browser the student is refused once the locked exam opens")
_, locked, _ = call("POST", attempts, {"candidate_assignment_id": locked_assignment["id"]}, token=student, expect=201,
                    headers=seb_headers(attempts, browser_exam_key))
attempt_path = f"{attempts}/{locked['id']}"
call("GET", attempt_path, token=student, expect=200, headers=seb_headers(attempt_path, browser_exam_key))
ok("inside Safe Exam Browser the student starts and reads the exam")
status, _, _ = call("GET", attempt_path, token=student, headers=seb_headers(attempts, browser_exam_key))
assert status == 403, status
status, _, _ = call("GET", attempt_path, token=student, headers=seb_headers(attempt_path, "0" * 64))
assert status == 403, status
ok("a hash for another URL or another key is refused")
print("ALL M4 CHECKS PASSED")
