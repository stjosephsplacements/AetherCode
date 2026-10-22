"""End-to-end smoke test of the platform through the gateway.

Run on the server after an upgrade:

    python3 smoke.py [admin-credentials-file] [gateway-url] [public-origin]

The credentials file holds "<email> <password>" (setup writes
~/aethercode-admin.txt). Every run uses fresh names, so it can be repeated;
it leaves its test college data behind. Exits non-zero on the first failure.
The public origin is what Safe Exam Browser hashes request URLs with; it must
match the gateway's GATEWAY_SEB_PUBLIC_ORIGIN; by default it is PUBLIC_ORIGIN
from the .env beside this script.
"""
import base64, gzip, hashlib, json, os, sys, time, urllib.request, urllib.error, uuid

CREDENTIALS = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser("~/aethercode-admin.txt")
BASE = (sys.argv[2] if len(sys.argv) > 2 else "http://127.0.0.1:8380") + "/api"
def env_origin():
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
    for line in open(path):
        if line.startswith("PUBLIC_ORIGIN="):
            return line.split("=", 1)[1].strip()
    sys.exit("PUBLIC_ORIGIN is not in .env; pass the public origin as the third argument")
PUBLIC_ORIGIN = sys.argv[3] if len(sys.argv) > 3 else env_origin()
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
_, me, me_headers = call("GET", "/user/v1/me", token=student, expect=200)
assert me["principal_id"] == first["principal_id"] and me["student"] == {"tenant_id": tenant}, me
assert any(r["role_name"] == "student" for r in me["roles"]) and me_headers["Cache-Control"] == "no-store", me
ok("/me tells the student their own roles and college")

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
faculty_me = call("GET", "/user/v1/me", token=login(f"faculty.{run}", staff["password"]), expect=200)[1]
ok(f"faculty account created ({staff['role_assignment']['scope_kind']} scope) and signs in")
assert faculty_me["student"] is None and [r["role_name"] for r in faculty_me["roles"]] == ["department_user"], faculty_me
ok("/me shows faculty their staff role")
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
status, _, _ = call("GET", f"/question-bank/v1/question-versions/{version_id}/export", token=faculty)
assert status == 403, status
_, exported, _ = call("GET", f"/question-bank/v1/question-versions/{version_id}/export", token=admin, expect=200)
assert exported["format"] == "aethercode.question.v1" and any(not test["sample"] for test in exported["tests"]), exported
ok("only administrators export a question, hidden tests included (ADR-0032)")
status, refused, _ = call("POST", f"/question-bank/v1/question-versions/{version_id}/publish",
                           {"expected_question_version": version["version"]}, token=faculty)
assert status == 409 and "model solution" in json.dumps(refused), (status, refused)
ok("a question cannot be published before a model solution passes every test (ADR-0047)")
checks_path = f"/question-bank/v1/question-versions/{version_id}/model-checks"
call("POST", checks_path, {"language": "python3", "source": "a, b = map(int, input().split())\nprint(a + b)\n"}, token=faculty, expect=202)
for _ in range(60):
    _, checks, _ = call("GET", checks_path, token=faculty, expect=200)
    if checks and checks[0]["lifecycle_state"] != "queued":
        break
    time.sleep(1)
else:
    sys.exit(f"FAIL the model-solution check never finished: {checks}")
assert checks[0]["lifecycle_state"] == "completed" and checks[0]["units"] and all(u["verdict"] == "accepted" for u in checks[0]["units"]), checks[0]
ok("a model solution runs on every test, hidden ones included, through Judge (ADR-0033)")
call("POST", f"/question-bank/v1/question-versions/{version_id}/publish",
     {"expected_question_version": version["version"]}, token=faculty, expect=200)
ok("question published")

# Practice (ADR-0041). The bank is shared by every college, so the smoke
# question goes back to tests at the end and real students never see it.
practice = f"/question-bank/v1/tenants/{tenant}/practice"
question_id = question["question"]["id"]
audience_path = f"/question-bank/v1/questions/{question_id}/audience"
practice_ids = lambda: [p["question_id"] for p in call("GET", f"{practice}/questions", token=student, expect=200)[1]]
assert question_id not in practice_ids()
status, _, _ = call("GET", f"{practice}/questions/{question_id}", token=student)
assert status == 404, status
status, _, _ = call("PUT", audience_path, {"audience": "practice"}, token=student)
assert status == 403, status
ok("a test question is invisible to students, and students cannot move it")
call("PUT", audience_path, {"audience": "practice"}, token=faculty, expect=200)
try:
    assert question_id in practice_ids()
    _, problem, _ = call("GET", f"{practice}/questions/{question_id}", token=student, expect=200)
    assert problem["samples"] == [{"input": "1 2\n", "expected_output": "3\n"}, {"input": "5 7\n", "expected_output": "12\n"}], problem
    assert "100 200" not in json.dumps(problem) and "object_key" not in json.dumps(problem), problem
    ok("a practice problem shows its sample tests, never hidden ones")

    def practise(body):
        _, started, _ = call("POST", f"{practice}/questions/{question_id}/submissions", body, token=student, expect=202)
        for _ in range(90):
            _, found, _ = call("GET", f"{practice}/submissions/{started['id']}", token=student, expect=200)
            if found["lifecycle_state"] != "queued":
                return found
            time.sleep(1)
        sys.exit(f"FAIL the practice run never finished: {found}")

    solution = "a, b = map(int, input().split())\nprint(a + b)\n"
    sample_run = practise({"language": "python3", "mode": "run", "source": solution})
    assert [(u["stdin"], u["stdout"], u["verdict"]) for u in sample_run["units"]] == [("1 2\n", "3\n", "accepted"), ("5 7\n", "12\n", "accepted")], sample_run
    ok("a practice run shows sample input, expected and actual output")
    own = practise({"language": "python3", "mode": "run", "source": solution, "input": "20 22\n"})
    assert own["custom_input"] and own["units"][0]["stdout"] == "42\n", own
    ok("a practice run on the student's own input returns its output")
    judged = practise({"language": "python3", "mode": "submit", "source": solution})
    assert judged["verdict"] == "accepted" and judged["passed_units"] == judged["total_units"] == 4, judged
    assert judged["source"] == solution and all("stdout" not in u for u in judged["units"]), judged
    ok("a practice submission is judged on every test; hidden tests show verdicts only")
    status, _, _ = call("GET", f"{practice}/submissions/{judged['id']}", token=faculty)
    assert status in (403, 404), status
    _, progress, _ = call("GET", f"{practice}/progress", token=student, expect=200)
    assert progress["solved"] >= 1 and progress["accepted"] >= 1 and progress["active_days"], progress
    ok("practice runs are the student's own, and progress counts the solve")
finally:
    call("PUT", audience_path, {"audience": "test"}, token=faculty, expect=200)
assert question_id not in practice_ids()
ok("moved back to tests, the question leaves practice")

_, policy, _ = call("POST", f"/assessment/v1/tenants/{tenant}/proctor-policies", {"name": f"Lab {run}"}, token=faculty, expect=201)
_, policy_version, _ = call("POST", f"/assessment/v1/tenants/{tenant}/proctor-policies/{policy['id']}/versions",
                           {"expected_policy_version": policy["version"], "policy": {"seb_required": False}}, token=faculty, expect=201)
call("POST", f"/assessment/v1/tenants/{tenant}/proctor-policy-versions/{policy_version['id']}/publish", {}, token=faculty, expect=200)
iso = lambda seconds: time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(seconds))

def publish_exam(title, duration_seconds, check_unknown_question=False, target=None, question_version=None):
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
                      "question_version_id": question_version or version_id, "maximum_score": "10"}, token=faculty, expect=201)
    if question_version is None:
        assert item["question_version_id"] == version_id and len(item["evaluation_bundle_checksum"]) == 64, item
    call("POST", f"{versions_path}/publish", {"expected_content_version": content()}, token=faculty, expect=200)
    target_type, target_id = target or ("batch", batch["id"])
    call("POST", f"{versions_path}/assignment-rules", {"target_type": target_type, "target_id": target_id,
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
publish_exam("Placement smoke test", 3600, target=("placement_department", placement["id"]))
ok("an exam assigned to the student's placement department reaches the student")
assert (assignment["title"], assignment["exam_id"], assignment["duration_seconds"]) == ("Smoke test", exam_version["exam_id"], 3600), assignment
assert assignment["instructions_markdown"] == "Solve it.", assignment
ok("the student's assignment carries the exam's title, id, instructions and duration")
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
_, paper, paper_headers = call("GET", f"{attempts}/{attempt['id']}/paper", token=student, expect=200)
paper_item = paper["items"][0]
assert paper["title"] == "Smoke test" and paper_headers["Cache-Control"] == "no-store", paper
assert (paper_item["exam_item_id"], paper_item["title"], paper_item["prompt_markdown"]) == (item["id"], "Sum two numbers", "Print a + b."), paper_item
assert paper_item["latest_answer"] == {"language": "python3", "source": source, "revision_number": 1}, paper_item
assert "source_object_key" not in json.dumps(paper), paper
ok("the paper shows the statement and gives back the saved code")

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

_, custom, _ = call("POST", f"{attempts}/{attempt['id']}/items/{item['id']}/runs",
                    {"language": "python3", "source": source, "input": "20 22\n"}, token=student, expect=202)
for _ in range(60):
    _, custom, _ = call("GET", f"{attempts}/{attempt['id']}/runs/{custom['id']}", token=student, expect=200)
    if custom["lifecycle_state"] in ("completed", "failed"):
        break
    time.sleep(1)
assert len(custom["units"]) == 1 and custom["units"][0]["stdout"] == "42\n", custom
ok("a custom-input run returns the program's output for the student's own input")

submissions_path = f"{attempts}/{attempt['id']}/items/{item['id']}/submissions"
_, item_submission, _ = call("POST", submissions_path, token=student, expect=202)
_, again, _ = call("POST", submissions_path, token=student, expect=202)
assert again["id"] == item_submission["id"], (item_submission, again)
for _ in range(60):
    _, listed, _ = call("GET", submissions_path, token=student, expect=200)
    judged = [s for s in listed["items"] if s["id"] == item_submission["id"] and s["lifecycle_state"] == "completed"]
    if judged:
        break
    time.sleep(1)
else:
    sys.exit(f"FAIL the per-question submit was never judged: {listed}")
judged = judged[0]
assert (judged["passed_units"], judged["total_units"], judged["verdict_counts"]) == (3, 4, {"accepted": 3, "wrong_answer": 1}), judged
assert "stdin" not in json.dumps(listed) and "unit_number" not in json.dumps(listed), listed
_, attempt, _ = call("GET", f"{attempts}/{attempt['id']}", token=student, expect=200)
assert attempt["lifecycle_state"] == "active", attempt
ok("Submit judges all tests, shows hidden ones as counts only, and leaves the exam running")
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

# --- M6: exam-day operations (ADR-0027) -----------------------------------
operations = f"/submission/v1/tenants/{tenant}/exam-versions/{exam_version['id']}"
status, _, _ = call("GET", f"{operations}/monitor", token=student)
assert status == 403, status
status, _, _ = call("POST", f"{operations}/announcements", {"body": "spoof"}, token=student)
assert status == 403, status
ok("a student can reach neither the live monitor nor announcements")
_, monitor, _ = call("GET", f"{operations}/monitor", token=faculty, expect=200)
row = [c for c in monitor["candidates"] if c["attempt_id"] == attempt["id"]]
assert row and row[0]["lifecycle_state"] == "graded" and row[0]["score"] is not None, monitor
ok("the live monitor lists the student's graded attempt with its score")
_, hidden, _ = call("GET", f"{attempts}/{attempt['id']}/result", token=student, expect=200)
assert hidden == {"released": False}, hidden
call("PUT", f"{operations}/results-release", {"released": True}, token=faculty, expect=200)
_, released, _ = call("GET", f"{attempts}/{attempt['id']}/result", token=student, expect=200)
assert released["released"] and float(released["score"]) == float(row[0]["score"]) and len(released["items"]) == 1, released
ok("the score stays hidden until faculty release results, then shows per question")

opens, ops_version, ops_item, ops_assignment = publish_exam("Operations smoke test", 3600)
time.sleep(max(0, opens + 2 - time.time()))
_, running, _ = call("POST", attempts, {"candidate_assignment_id": ops_assignment["id"]}, token=student, expect=201)
ops = f"/submission/v1/tenants/{tenant}/exam-versions/{ops_version['id']}"
_, extended, _ = call("POST", f"{ops}/extensions", {"minutes": 10}, token=faculty, expect=200)
assert extended == {"extended_attempts": 1}, extended
call("POST", f"{ops}/announcements", {"body": "Question 1 is fine as written."}, token=faculty, expect=201)
_, live, _ = call("GET", f"{attempts}/{running['id']}/live", token=student, expect=200)
moved = (time.mktime(time.strptime(live["submission_deadline"][:19], "%Y-%m-%dT%H:%M:%S"))
         - time.mktime(time.strptime(running["submission_deadline"][:19], "%Y-%m-%dT%H:%M:%S")))
assert moved == 600 and [n["body"] for n in live["announcements"]] == ["Question 1 is fine as written."], live
call("PUT", f"{attempts}/{running['id']}/answers/{ops_item['id']}",
     {"language": "python3", "source": source, "expected_attempt_version": running["version"]}, token=student, expect=201)
ok("extra time moves the open attempt's deadline, announcements reach it, and saving still works")
# Multiple choice (ADR-0035): authored, assigned, answered and graded with no Judge work.
mcq_body = dict(question_body, slug=f"mcq-{run}", title="Binary search", prompt_markdown="Binary search runs in?", supported_languages=[])
_, mcq, _ = call("POST", "/question-bank/v1/questions", mcq_body, token=faculty, expect=201)
mcq_version = mcq["question_version"]
_, mcq_version, _ = call("PUT", f"/question-bank/v1/question-versions/{mcq_version['id']}/choices",
                         {"expected_question_version": mcq_version["version"], "choices": ["O(n)", "O(log n)", "O(1)"],
                          "correct_choices": [1], "multiple_choice": False}, token=faculty, expect=200)
call("POST", f"/question-bank/v1/question-versions/{mcq_version['id']}/publish",
     {"expected_question_version": mcq_version["version"]}, token=faculty, expect=200)
opens, mcq_exam, mcq_item, mcq_assignment = publish_exam("Choice smoke test", 3600, question_version=mcq_version["id"])
time.sleep(max(0, opens + 2 - time.time()))
_, choice_attempt, _ = call("POST", attempts, {"candidate_assignment_id": mcq_assignment["id"]}, token=student, expect=201)
_, choice_paper, _ = call("GET", f"{attempts}/{choice_attempt['id']}/paper", token=student, expect=200)
assert choice_paper["items"][0]["kind"] == "mcq" and "correct_choices" not in json.dumps(choice_paper), choice_paper
status, _, _ = call("PUT", f"{attempts}/{choice_attempt['id']}/choices/{mcq_item['id']}", {"selected": [0, 1]}, token=student)
assert status == 400, status
call("PUT", f"{attempts}/{choice_attempt['id']}/choices/{mcq_item['id']}", {"selected": [1]}, token=student, expect=200)
call("POST", f"{attempts}/{choice_attempt['id']}/submit", {"expected_attempt_version": choice_attempt["version"]}, token=student, expect=202)
_, choice_attempt, _ = call("GET", f"{attempts}/{choice_attempt['id']}", token=student, expect=200)
assert choice_attempt["lifecycle_state"] == "graded", choice_attempt
_, choice_monitor, _ = call("GET", f"/submission/v1/tenants/{tenant}/exam-versions/{mcq_exam['id']}/monitor", token=faculty, expect=200)
choice_row = [c for c in choice_monitor["candidates"] if c["attempt_id"] == choice_attempt["id"]]
assert choice_row and float(choice_row[0]["score"]) == 10.0 and float(choice_row[0]["maximum_score"]) == 10.0, choice_monitor
ok("a multiple-choice question is answered, never shows its key, and is graded on hand-in")

# Staff operations views (ADR-0043).
_, queue, _ = call("GET", f"/submission/v1/tenants/{tenant}/grading-queue", token=admin, expect=200)
assert {"evaluations", "runs"} <= set(queue) and queue["evaluations"]["completed_last_hour"] >= 1, queue
status, _, _ = call("GET", f"/submission/v1/tenants/{tenant}/grading-queue", token=student)
assert status == 403, status
ok("staff see the grading queue; students cannot")
_, audit, _ = call("GET", f"/user/v1/tenants/{tenant}/staff-audit", token=admin, expect=200)
assert any(e["service"] == "submission" and e["resource_type"] == "attempt_events" and e["allowed"] for e in audit), audit[:5]
assert not any(e["resource_type"] == "attempts" for e in audit), "students' own writes are not staff actions"
status, _, _ = call("GET", f"/user/v1/tenants/{tenant}/staff-audit", token=faculty)
assert status == 403, status
ok("the audit log records staff actions (extra time, announcements) for administrators only")
faculty_id = json.loads(base64.urlsafe_b64decode(faculty.split(".")[1] + "=="))["sub"]
_, named, _ = call("POST", f"/user/v1/tenants/{tenant}/accounts/describe", {"principal_ids": [faculty_id, admin_id]}, token=admin, expect=200)
assert [n["display_name"] for n in named] == ["Faculty One"] and "password" not in json.dumps(named), named
ok("staff names are described for this college's accounts only")
print("ALL M6 CHECKS PASSED")

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

# --- Staff try an exam as a student (ADR-0046) ---------------------------
base = f"/assessment/v1/tenants/{tenant}"
_, preview_exam, _ = call("POST", f"{base}/exams", {}, token=faculty, expect=201)
preview_opens = time.time() - 20
_, preview_version, _ = call("POST", f"{base}/exams/{preview_exam['id']}/versions", {
    "expected_exam_version": preview_exam["version"], "title": "[Preview] Smoke test", "instructions_markdown": "Solve it.",
    "opens_at": iso(preview_opens), "closes_at": iso(time.time() + 4200), "duration_seconds": 3600,
    "proctor_policy_version_id": policy_version["id"]}, token=faculty, expect=201)
preview_path = f"{base}/exam-versions/{preview_version['id']}"
preview_content = lambda: call("GET", preview_path, token=faculty, expect=200)[1]["content_version"]
_, preview_section, _ = call("POST", f"{preview_path}/sections", {"expected_content_version": preview_content(), "position": 1,
                             "title": "Coding", "instructions_markdown": "", "time_limit_seconds": None}, token=faculty, expect=201)
call("POST", f"{preview_path}/sections/{preview_section['id']}/items", {"expected_content_version": preview_content(), "position": 1,
     "question_version_id": version_id, "maximum_score": "10"}, token=faculty, expect=201)
call("POST", f"{preview_path}/publish", {"expected_content_version": preview_content()}, token=faculty, expect=200)
_, preview_rule, _ = call("POST", f"{preview_path}/assignment-rules", {"target_type": "student", "target_id": faculty_id,
                          "available_from": preview_version["opens_at"], "available_until": preview_version["closes_at"], "accommodations": {}},
                          token=faculty, expect=201)
_, preview_assignment, _ = call("POST", f"{base}/assignment-rules/{preview_rule['id']}/candidate-assignments",
                                {"candidate_id": faculty_id}, token=faculty, expect=201)
for _ in range(15):
    _, mine, _ = call("GET", f"{base}/candidate-assignments", token=faculty, expect=200)
    if any(a["id"] == preview_assignment["id"] for a in mine["items"]):
        break
    time.sleep(2)
else:
    sys.exit(f"FAIL staff never received their private copy: {mine}")
_, preview_attempt, _ = call("POST", attempts, {"candidate_assignment_id": preview_assignment["id"]}, token=faculty, expect=201)
_, preview_paper, _ = call("GET", f"{attempts}/{preview_attempt['id']}/paper", token=faculty, expect=200)
assert preview_paper["title"] == "[Preview] Smoke test" and len(preview_paper["items"]) == 1, preview_paper
ok("staff start and read a private copy of an exam as a student")
print("ALL PREVIEW CHECKS PASSED")

# --- Community content (ADR-0048) -----------------------------------------
community = f"/notification/v1/tenants/{tenant}/community"
_, experience, _ = call("POST", f"{community}/interview-experiences", {
    "company": f"Acme {run}", "role": "SDE", "verdict": "selected",
    "rounds": [{"title": "Online test", "description": "Two coding questions."}]}, token=student, expect=201)
assert experience["status"] == "pending" and experience["mine"] and experience["author_id"] is None, experience
_, shared, _ = call("GET", f"{community}/interview-experiences", token=student, expect=200)
assert not any(e["id"] == experience["id"] for e in shared["items"]), shared
status, _, _ = call("GET", f"{community}/moderation/interview-experiences", token=student)
assert status == 403, status
status, _, _ = call("POST", f"{community}/moderation/interview-experiences/{experience['id']}/review", {"approve": True}, token=student)
assert status == 403, status
ok("a student's interview experience waits for staff; students cannot moderate")
call("POST", f"{community}/moderation/interview-experiences/{experience['id']}/review", {"approve": True, "note": "Thanks"}, token=faculty, expect=200)
_, shared, _ = call("GET", f"{community}/interview-experiences?company=acme", token=student, expect=200)
assert any(e["id"] == experience["id"] and e["author_id"] is None for e in shared["items"]), shared
ok("once approved, the experience is visible to students without its author")
_, listing, _ = call("PUT", f"{community}/moderation/feed", {
    "kind": "contest", "title": f"Smoke contest {run}", "url": "https://codeforces.com/contests", "platform": "Codeforces",
    "external_id": f"smoke-{run}"}, token=faculty, expect=200)
call("PUT", f"{community}/feed/{listing['id']}/bookmark", {"on": True}, token=student, expect=200)
_, saved, _ = call("GET", f"{community}/feed?bookmarked=true", token=student, expect=200)
assert [i["id"] for i in saved["items"]] == [listing["id"]], saved
call("PUT", f"{community}/profile-links/github", {"handle": "octocat"}, token=student, expect=200)
_, links, _ = call("GET", f"{community}/profile-links", token=student, expect=200)
assert links["items"] == [{"platform": "github", "handle": "octocat"}], links
ok("listings, bookmarks and linked accounts work for a student")
print("ALL COMMUNITY CHECKS PASSED")
