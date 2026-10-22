"""Verifies code execution end to end, as v1's `pnpm engine-check` does.

Every exam language must give the expected verdict for a correct, a wrong, a
slow and a broken program. Each program runs as a model-solution check
(ADR-0033), so the whole path is exercised: gateway, Question Bank, Judge and
the AetherCode Execution Engine. Run on the server:

    python3 engine-check.py [admin-credentials-file] [gateway-url]

It keeps one draft question, slug "engine-check", in the administrator's
drafts and reuses it on every run. Prints "Engine OK" or exits non-zero.
"""
import json, os, sys, time, urllib.error, urllib.request, uuid

CREDENTIALS = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser("~/aethercode-admin.txt")
BASE = (sys.argv[2] if len(sys.argv) > 2 else "http://127.0.0.1:8380") + "/api"
admin_email, admin_password = open(CREDENTIALS).read().split()[:2]

PROGRAMS = {
    "c": {
        "ok": '#include <stdio.h>\nint main(void){long long n;scanf("%lld",&n);printf("%lld\\n",n*(n+1)/2);return 0;}\n',
        "wrong": '#include <stdio.h>\nint main(void){int n;scanf("%d",&n);printf("%d\\n",n*(n+1)/2);return 0;}\n',
        "slow": "int main(void){volatile unsigned long i=0;for(;;)i++;}\n",
        "broken": "int main(void){ return }\n",
    },
    "cpp17": {
        "ok": '#include <bits/stdc++.h>\nint main(){long long n;std::cin>>n;std::cout<<n*(n+1)/2<<"\\n";}\n',
        "wrong": '#include <bits/stdc++.h>\nint main(){int n;std::cin>>n;std::cout<<n*(n+1)/2<<"\\n";}\n',
        "slow": "int main(){volatile unsigned long i=0;for(;;)i++;}\n",
        "broken": "int main(){ std::cout << }\n",
    },
    "java": {
        "ok": "import java.util.*;\npublic class Main{public static void main(String[] a){long n=new Scanner(System.in).nextLong();System.out.println(n*(n+1)/2);}}\n",
        "wrong": "import java.util.*;\npublic class Main{public static void main(String[] a){int n=new Scanner(System.in).nextInt();System.out.println(n*(n+1)/2);}}\n",
        "slow": "public class Main{public static void main(String[] a){long i=0;while(true){i++;}}}\n",
        "broken": "public class Main{ void }\n",
    },
    "python3": {
        "ok": "n = int(input())\nprint(n * (n + 1) // 2)\n",
        "wrong": "n = int(input())\nprint(n * n)\n",
        "slow": "while True:\n    pass\n",
        "broken": "def main(:\n",
    },
}
EXPECT = {"ok": "accepted", "wrong": "wrong_answer", "slow": "time_limit_exceeded", "broken": "compile_error"}
TESTS = [
    {"input": "5\n", "expected_output": "15\n", "sample": True},
    {"input": "1000000\n", "expected_output": "500000500000\n", "sample": False},
]


def call(method, path, body=None, token=None):
    request = urllib.request.Request(BASE + path, data=json.dumps(body).encode() if body is not None else None, method=method)
    request.add_header("Content-Type", "application/json")
    if method != "GET":
        request.add_header("Idempotency-Key", str(uuid.uuid4()))
    if token:
        request.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.status, json.loads(response.read() or b"null")
    except urllib.error.HTTPError as error:
        return error.code, error.read().decode(errors="replace")


def must(method, path, body=None, token=None, expect=200):
    status, payload = call(method, path, body, token)
    if status != expect:
        sys.exit(f"FAIL {method} {path}: HTTP {status} {payload}")
    return payload


token = must("POST", "/identity/v1/auth/login", {"identifier": admin_email, "password": admin_password})["access_token"]

# One reusable draft question with tests in every language.
drafts = must("GET", "/question-bank/v1/questions?limit=100&status=draft", token=token)["items"]
draft = next((d for d in drafts if d["question"]["slug"] == "engine-check"), None)
if draft is None:
    draft = must("POST", "/question-bank/v1/questions", {
        "slug": "engine-check", "title": "Engine check", "prompt_markdown": "Print n(n+1)/2.",
        "difficulty": "easy", "supported_languages": list(PROGRAMS), "time_limit_ms": 1000,
        "memory_limit_kib": 262144, "tags": [],
    }, token, expect=201)
version = draft["question_version"]
if version["hidden_test_case_count"] == 0:
    version = must("PUT", f"/question-bank/v1/question-versions/{version['id']}/tests",
                   {"expected_question_version": version["version"], "tests": TESTS}, token)
checks = f"/question-bank/v1/question-versions/{version['id']}/model-checks"

print(f"question version {version['id']}\n")
failures = 0
for language, programs in PROGRAMS.items():
    for name, source in programs.items():
        started = time.time()
        check_id = must("POST", checks, {"language": language, "source": source}, token, expect=202)["id"]
        verdict = None
        for _ in range(180):
            found = next((c for c in must("GET", checks, token=token) if c["id"] == check_id), None)
            if found and found["lifecycle_state"] != "queued":
                verdict = found["verdict"] if found["lifecycle_state"] == "completed" else "failed"
                break
            time.sleep(1)
        # Python's broken program fails when it runs, not when it compiles.
        want = "runtime_error" if language == "python3" and name == "broken" else EXPECT[name]
        good = verdict == want
        failures += not good
        print(f"{'PASS' if good else 'FAIL'}  {language:<7} {name:<6} -> {verdict}{'' if good else f' (expected {want})'}  {round((time.time() - started) * 1000)}ms")

print("\nEngine OK" if failures == 0 else f"\n{failures} check(s) failed")
sys.exit(0 if failures == 0 else 1)
