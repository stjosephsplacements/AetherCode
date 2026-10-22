"""Load test of an exam through the gateway, as v1's `pnpm loadtest` (M8).

N students each sign in, open the exam, start it, load the paper, autosave,
run their code on the samples, submit the question and end the test, the way
the exam screen does. Run on the server, never during a real exam:

    python3 loadtest.py --students 1000 --ramp 60 --runs 3

It sets up its own batch of students, a question and a one-question exam in
the first college, signed in as the administrator in ~/aethercode-admin.txt
(like smoke.py, it leaves that data behind, named LOADTEST-<run>). Every
student sends its own lab address in X-Forwarded-For, which the gateway
trusts from this host, so per-address sign-in limits behave as in a lab.

Prints per-step latency (p50/p95/p99), errors, and how long Judge took to
return run and submission verdicts. Exits non-zero if any student failed.
"""
import argparse, json, os, random, statistics, sys, threading, time, urllib.error, urllib.request, uuid
from concurrent.futures import ThreadPoolExecutor

parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
parser.add_argument("--students", type=int, default=200)
parser.add_argument("--ramp", type=float, default=30, help="seconds over which students arrive")
parser.add_argument("--runs", type=int, default=3, help="sample runs per student")
parser.add_argument("--gateway", default="http://127.0.0.1:8380")
parser.add_argument("--credentials", default=os.path.expanduser("~/aethercode-admin.txt"))
args = parser.parse_args()
BASE = args.gateway + "/api"
RUN = uuid.uuid4().hex[:6].upper()

SOLUTION = "n = int(input())\nprint(n * (n + 1) // 2)\n"
TESTS = [
    {"input": "5\n", "expected_output": "15\n", "sample": True},
    {"input": "10\n", "expected_output": "55\n", "sample": True},
    {"input": "1000000\n", "expected_output": "500000500000\n", "sample": False},
    {"input": "1\n", "expected_output": "1\n", "sample": False},
]

timings, errors, lock = {}, [], threading.Lock()


def call(method, path, body=None, token=None, address=None, expect=None, step=None):
    """One request; records its latency under step and retries 429/503."""
    for attempt in range(6):
        request = urllib.request.Request(BASE + path, data=json.dumps(body).encode() if body is not None else None, method=method)
        request.add_header("Content-Type", "application/json")
        if method != "GET":
            request.add_header("Idempotency-Key", str(uuid.uuid4()))
        if token:
            request.add_header("Authorization", "Bearer " + token)
        if address:
            request.add_header("X-Forwarded-For", address)
        started = time.perf_counter()
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                status, raw, headers = response.status, response.read(), response.headers
        except urllib.error.HTTPError as error:
            status, raw, headers = error.code, error.read(), error.headers
        except (urllib.error.URLError, TimeoutError) as error:
            status, raw, headers = 0, str(error).encode(), {}
        elapsed = time.perf_counter() - started
        if status in (429, 503) and attempt < 5:
            time.sleep(float(headers.get("Retry-After", "1")) + random.random())
            continue
        if step:
            with lock:
                timings.setdefault(step, []).append(elapsed)
        if expect is not None and status != expect:
            raise RuntimeError(f"{step or path}: HTTP {status} {raw[:200]!r}")
        return json.loads(raw) if raw else None
    raise RuntimeError(f"{step or path}: still throttled after retries")


def setup():
    email, password = open(args.credentials).read().split()[:2]
    admin = call("POST", "/identity/v1/auth/login", {"identifier": email, "password": password}, expect=200)["access_token"]
    tenant = call("GET", "/tenant/v1/tenants", token=admin, expect=200)["items"][0]["id"]
    department = call("GET", f"/tenant/v1/tenants/{tenant}/departments", token=admin, expect=200)["items"][0]["id"]
    organization = call("POST", "/tenant/v1/placement-organizations", {"code": f"LT{RUN}", "legal_name": f"LOADTEST-{RUN}"}, token=admin, expect=201)
    placement = call("POST", f"/tenant/v1/placement-organizations/{organization['id']}/departments",
                     {"code": "LT", "name": "Load test placement"}, token=admin, expect=201)
    batch = call("POST", f"/tenant/v1/tenants/{tenant}/batches", {"department_id": department, "code": f"LT{RUN}",
                 "name": f"LOADTEST-{RUN}", "academic_year": "2026-2027"}, token=admin, expect=201)
    time.sleep(5)  # the batch reaches the user service over NATS

    accounts = []
    for start in range(0, args.students, 500):
        chunk = [{"roll_number": f"LT{RUN}{n:05d}", "name": f"Load Student {n}"} for n in range(start, min(args.students, start + 500))]
        imported = call("POST", f"/user/v1/tenants/{tenant}/students/import",
                        {"batch_id": batch["id"], "college_department_id": department,
                         "placement_department_id": placement["id"], "students": chunk}, token=admin, expect=201)
        accounts += [(a["roll_number"], a["password"]) for a in imported["imported"]]
    print(f"{len(accounts)} students imported into batch LOADTEST-{RUN}")

    question = call("POST", "/question-bank/v1/questions", {
        "slug": f"loadtest-{RUN.lower()}", "title": "Triangle number", "prompt_markdown": "Print n(n+1)/2.",
        "difficulty": "easy", "supported_languages": ["python3"], "time_limit_ms": 2000, "memory_limit_kib": 262144, "tags": [],
    }, token=admin, expect=201)
    version = call("PUT", f"/question-bank/v1/question-versions/{question['question_version']['id']}/tests",
                   {"expected_question_version": question["question_version"]["version"], "tests": TESTS}, token=admin, expect=200)
    # Publishing needs a model solution that passes every test (ADR-0047).
    checks = f"/question-bank/v1/question-versions/{version['id']}/model-checks"
    call("POST", checks, {"language": "python3", "source": "n = int(input())\nprint(n * (n + 1) // 2)\n"}, token=admin, expect=202)
    for _ in range(60):
        done = call("GET", checks, token=admin, expect=200)
        if done and done[0]["lifecycle_state"] != "queued":
            break
        time.sleep(1)
    assert done and done[0]["verdict"] == "accepted", done
    call("POST", f"/question-bank/v1/question-versions/{version['id']}/publish", {"expected_question_version": version["version"]}, token=admin, expect=200)

    policy = call("POST", f"/assessment/v1/tenants/{tenant}/proctor-policies", {"name": f"Load test {RUN}"}, token=admin, expect=201)
    policy_version = call("POST", f"/assessment/v1/tenants/{tenant}/proctor-policies/{policy['id']}/versions",
                          {"expected_policy_version": policy["version"], "policy": {"seb_required": False}}, token=admin, expect=201)
    call("POST", f"/assessment/v1/tenants/{tenant}/proctor-policy-versions/{policy_version['id']}/publish", {}, token=admin, expect=200)
    exam = call("POST", f"/assessment/v1/tenants/{tenant}/exams", {"external_reference": f"LOADTEST-{RUN}"}, token=admin, expect=201)
    iso = lambda seconds: time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(seconds))
    opens = time.time() + 30
    exam_version = call("POST", f"/assessment/v1/tenants/{tenant}/exams/{exam['id']}/versions", {
        "expected_exam_version": exam["version"], "title": f"Load test {RUN}", "instructions_markdown": "Load test.",
        "opens_at": iso(opens), "closes_at": iso(opens + 4 * 3600), "duration_seconds": 3 * 3600,
        "proctor_policy_version_id": policy_version["id"]}, token=admin, expect=201)
    path = f"/assessment/v1/tenants/{tenant}/exam-versions/{exam_version['id']}"
    content = lambda: call("GET", path, token=admin, expect=200)["content_version"]
    section = call("POST", f"{path}/sections", {"expected_content_version": content(), "position": 1, "title": "Coding",
                   "instructions_markdown": "", "time_limit_seconds": None}, token=admin, expect=201)
    item = call("POST", f"{path}/sections/{section['id']}/items", {"expected_content_version": content(), "position": 1,
                "question_version_id": version["id"], "maximum_score": "10"}, token=admin, expect=201)
    call("POST", f"{path}/publish", {"expected_content_version": content()}, token=admin, expect=200)
    call("POST", f"{path}/assignment-rules", {"target_type": "batch", "target_id": batch["id"],
         "available_from": exam_version["opens_at"], "available_until": exam_version["closes_at"], "accommodations": {}},
         token=admin, expect=201)
    print(f"exam LOADTEST-{RUN} published; it opens at {exam_version['opens_at']}")
    return tenant, exam_version["id"], item["id"], accounts, opens


def poll(path, token, address, done, step):
    started = time.perf_counter()
    for _ in range(600):
        found = call("GET", path, token=token, address=address, expect=200)
        if done(found):
            with lock:
                timings.setdefault(step, []).append(time.perf_counter() - started)
            return found
        time.sleep(1.5)
    raise RuntimeError(f"{step}: no verdict after 15 minutes")


def student(index, roll, password, tenant, exam_version_id, item_id):
    # One address per student, as from a lab machine behind nginx.
    address = f"10.{100 + index // 65536}.{index // 256 % 256}.{index % 256}"
    token = call("POST", "/identity/v1/auth/login", {"identifier": roll, "password": password}, address=address, expect=200, step="sign in")["access_token"]
    assignments = None
    for _ in range(60):
        assignments = call("GET", f"/assessment/v1/tenants/{tenant}/candidate-assignments", token=token, address=address, expect=200, step="exam list")
        mine = [a for a in assignments["items"] if a.get("exam_version_id") == exam_version_id]
        if mine:
            break
        time.sleep(2)
    else:
        raise RuntimeError("the exam never reached the student")
    attempts = f"/submission/v1/tenants/{tenant}/attempts"
    attempt = call("POST", attempts, {"candidate_assignment_id": mine[0]["id"]}, token=token, address=address, expect=201, step="start")
    call("GET", f"{attempts}/{attempt['id']}/paper", token=token, address=address, expect=200, step="paper")
    version = attempt["version"]
    for draft in (SOLUTION[:20], SOLUTION[:40], SOLUTION):
        saved = call("PUT", f"{attempts}/{attempt['id']}/answers/{item_id}", {"language": "python3", "source": draft,
                     "expected_attempt_version": version}, token=token, address=address, expect=201, step="autosave")
        version = saved.get("attempt_version", version)
        time.sleep(random.uniform(1, 4))
    for _ in range(args.runs):
        started = call("POST", f"{attempts}/{attempt['id']}/items/{item_id}/runs", {"language": "python3", "source": SOLUTION},
                       token=token, address=address, expect=202, step="run")
        run = poll(f"{attempts}/{attempt['id']}/runs/{started['id']}", token, address,
                   lambda found: found["lifecycle_state"] in ("completed", "failed", "cancelled"), "run verdict")
        if run["lifecycle_state"] != "completed":
            raise RuntimeError(f"run ended {run['lifecycle_state']}")
        time.sleep(random.uniform(2, 8))
    submissions = f"{attempts}/{attempt['id']}/items/{item_id}/submissions"
    submitted = call("POST", submissions, token=token, address=address, expect=202, step="submit question")
    poll(submissions, token, address,
         lambda listed: any(s["id"] == submitted["id"] and s["lifecycle_state"] in ("completed", "failed") for s in listed["items"]),
         "submission verdict")
    call("POST", f"{attempts}/{attempt['id']}/submit", {"expected_attempt_version": version}, token=token, address=address,
         expect=202, step="end test")


def percentile(values, p):
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, int(p / 100 * len(ordered)))]


def main():
    tenant, exam_version_id, item_id, accounts, opens = setup()
    time.sleep(max(0, opens + 2 - time.time()))
    print(f"{len(accounts)} students arriving over {args.ramp:.0f}s, {args.runs} runs each\n")
    started = time.time()

    def one(indexed):
        index, (roll, password) = indexed
        time.sleep(index * args.ramp / max(1, len(accounts)))
        try:
            student(index, roll, password, tenant, exam_version_id, item_id)
        except Exception as error:  # every failure is counted and reported
            with lock:
                errors.append(f"{roll}: {error}")

    with ThreadPoolExecutor(max_workers=len(accounts)) as pool:
        list(pool.map(one, enumerate(accounts)))

    print(f"{'step':<20}{'count':>7}{'p50':>9}{'p95':>9}{'p99':>9}{'max':>9}  seconds")
    for step in ("sign in", "exam list", "start", "paper", "autosave", "run", "run verdict", "submit question", "submission verdict", "end test"):
        values = timings.get(step, [])
        if values:
            print(f"{step:<20}{len(values):>7}{statistics.median(values):>9.3f}{percentile(values, 95):>9.3f}"
                  f"{percentile(values, 99):>9.3f}{max(values):>9.3f}")
    print(f"\n{len(accounts) - len(errors)} of {len(accounts)} students finished in {time.time() - started:.0f}s")
    for line in errors[:20]:
        print("ERROR", line)
    sys.exit(1 if errors else 0)


if __name__ == "__main__":
    main()
