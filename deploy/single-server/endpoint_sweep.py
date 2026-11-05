"""Calls every documented endpoint through the gateway and fails on a server error.

    python3 endpoint_sweep.py [admin-credentials-file] [gateway-url]

The credentials file is the one smoke.py uses ("<email> <password> <totp secret>"). For each operation
in the services' OpenAPI files the sweep sends: a request without a token (a secured operation must
answer 401/403), the same as the platform administrator, a department user and a student, then
malformed bodies on writes. Read operations use real ids discovered from the college; writes use
random ids so nothing real is changed. Any 5xx, any 2xx for an anonymous caller on a secured
operation, and any secret in an error body fails the run. Run it against a test platform.
"""
import base64, glob, hashlib, hmac, json, os, re, struct, sys, time, urllib.error, urllib.request, uuid
import yaml

CREDENTIALS = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser("~/aethercode-admin.txt")
BASE = (sys.argv[2] if len(sys.argv) > 2 else "http://127.0.0.1:8380") + "/api"
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "backend", "services")
words = open(CREDENTIALS).read().split()
admin_email, admin_password, admin_totp = words[0], words[1], (words[2] if len(words) > 2 else None)
run = uuid.uuid4().hex[:6]
last_step = [0]


def totp(secret):
    step = int(time.time() // 30)
    if step <= last_step[0]:
        time.sleep((step + 1) * 30 - time.time() + 0.5)
        step = int(time.time() // 30)
    last_step[0] = step
    digest = hmac.new(base64.b32decode(secret.upper() + "=" * (-len(secret) % 8)), struct.pack(">Q", step), hashlib.sha1).digest()
    offset = digest[-1] & 15
    return f"{(struct.unpack('>I', digest[offset:offset + 4])[0] & 0x7FFFFFFF) % 10**6:06d}"


def http(method, path, body=None, token=None, raw=None):
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    request = urllib.request.Request(BASE + path, data=data, method=method)
    request.add_header("Content-Type", "application/json")
    if method != "GET":
        request.add_header("Idempotency-Key", str(uuid.uuid4()))
    if token:
        request.add_header("Authorization", "Bearer " + token)
    for attempt in range(6):
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                status, payload = response.status, response.read()
        except urllib.error.HTTPError as error:
            status, payload = error.code, error.read()
            if status == 429 and attempt < 5:
                time.sleep(float(error.headers.get("Retry-After", "2")))
                continue
        except Exception as error:  # connection reset and the like count as a failure of the call
            return 0, str(error).encode()
        return status, payload
    return status, payload


def login(identifier, password, secret=None):
    status, payload = http("POST", "/identity/v1/auth/login", {"identifier": identifier, "password": password})
    pair = json.loads(payload)
    if pair.get("mfa_required"):
        _, payload = http("POST", "/identity/v1/auth/mfa/verify-login", {"mfa_challenge_token": pair["mfa_challenge_token"], "code": totp(secret)})
        pair = json.loads(payload)
    return pair["access_token"]


admin = login(admin_email, admin_password, admin_totp)
if admin_totp:
    _, payload = http("POST", "/identity/v1/auth/mfa/step-up", {"code": totp(admin_totp)}, admin)
    admin = json.loads(payload)["access_token"]


def get(path, token=admin):
    status, payload = http("GET", path, token=token)
    return json.loads(payload) if status == 200 and payload else None


tenants = get("/tenant/v1/tenants")
if not tenants or not tenants["items"]:
    sys.exit("no college yet: run smoke.py first")
tenant = tenants["items"][0]["id"]
department = get(f"/tenant/v1/tenants/{tenant}/departments")["items"][0]["id"]

# A department user and a student of this college.
status, payload = http("POST", f"/user/v1/tenants/{tenant}/staff", {"username": f"sweep.{run}", "display_name": "Sweep Staff", "role": "department_user", "department_id": department}, admin)
faculty = login(f"sweep.{run}", json.loads(payload)["password"])
ids = {"tenant_id": tenant, "department_id": department}
batches = get(f"/tenant/v1/tenants/{tenant}/batches") or {"items": []}
if batches["items"]:
    ids["batch_id"] = batches["items"][0]["id"]
student = None
students = get(f"/user/v1/tenants/{tenant}/students") or {"items": []}
roll = None
if students["items"] and "batch_id" in ids:
    status, payload = http("POST", f"/user/v1/tenants/{tenant}/accounts/{students['items'][0].get('principal_id', uuid.uuid4())}/password", token=admin)
    if status in (200, 201) and payload:
        reset = json.loads(payload)
        roll, password = students["items"][0].get("roll_number"), reset.get("password")
        if roll and password:
            student = login(roll, password)
exams = get(f"/assessment/v1/tenants/{tenant}/exams") or {"items": []}
if exams["items"]:
    ids["exam_id"] = exams["items"][0]["id"]
questions = get("/question-bank/v1/questions") or {"items": []}
if questions["items"]:
    first = questions["items"][0]
    ids["question_id"] = first.get("id") or first.get("question_id") or str(uuid.uuid4())
    ids["question_version_id"] = first.get("question_version_id") or (first.get("question_version") or {}).get("id") or str(uuid.uuid4())
print(f"discovered: {sorted(ids)}; student token: {'yes' if student else 'no'}")

operations = []
for spec in sorted(glob.glob(os.path.join(ROOT, "*", "api", "openapi.yaml"))):
    service = spec.split(os.sep)[-3]
    if service in ("gateway", "judge"):
        continue
    document = yaml.safe_load(open(spec))
    for path, methods in (document.get("paths") or {}).items():
        for method, operation in methods.items():
            if method in ("get", "post", "put", "patch", "delete"):
                secured = bool(operation.get("security", document.get("security", [{"bearerAuth": []}] if "bearerAuth" in str(document.get("components", {})) else [])))
                operations.append((service, path, method.upper(), secured))


def fill(path, real):
    def replace(match):
        name = match.group(1)
        return ids[name] if real and name in ids else str(uuid.uuid4())
    return re.sub(r"\{([a-z_]+)\}", replace, path)


failures, matrix = [], {}
for service, path, method, secured in operations:
    real = method == "GET"
    url = f"/{service}{fill(path, real)}"
    if re.search(r"/(logout|password-reset|login|register|verify|refresh)", url) and service == "identity" and method == "POST":
        continue  # credential flows are covered by smoke.py and the browser specs
    callers = [("anonymous", None), ("admin", admin), ("faculty", faculty)] + ([("student", student)] if student else [])
    for name, token in callers:
        bodies = [None] if method in ("GET", "DELETE") else [{}, {"unexpected": [1, 2, 3]}]
        for body in bodies:
            status, payload = http(method, url, body, token)
            matrix.setdefault((method, path), {})[name] = status
            if status >= 500 or status == 0:
                failures.append(f"{name} {method} {url} body={json.dumps(body)} -> {status} {payload[:160]!r}")
            if name == "anonymous" and secured and status < 400:
                failures.append(f"anonymous {method} {url} -> {status} on a secured operation")
            text = payload.decode("utf-8", "ignore").lower()
            if status >= 400 and any(word in text for word in ("sqlstate", "stack trace", "goroutine", "pq:", "pgx", "panic:")):
                failures.append(f"{name} {method} {url} -> {status} leaks internals: {payload[:160]!r}")

codes = {}
for row in matrix.values():
    for status in row.values():
        codes[status] = codes.get(status, 0) + 1
print(f"{len(operations)} operations swept; status counts {dict(sorted(codes.items()))}")
if failures:
    print("\n".join(sorted(set(failures))))
    sys.exit(f"FAIL {len(set(failures))} problems")
print("PASS endpoint sweep")
