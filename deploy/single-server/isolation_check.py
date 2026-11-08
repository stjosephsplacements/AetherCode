"""Checks that one college cannot reach another college's data.

    python3 isolation_check.py [admin-credentials-file] [gateway-url]

Creates a second college with a department, a batch and a student, then calls every tenant-scoped
read operation in the services' OpenAPI files for that college as a department user and as a student
of the first college. Each call must be refused (401/403/404) or answer with nothing: a 200 that
carries the other college's data fails the run. Writes are attempted with empty bodies on the other
college and must never succeed. Run it against a test platform.
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
tenant_a = tenants["items"][0]["id"]
department_a = get(f"/tenant/v1/tenants/{tenant_a}/departments")["items"][0]["id"]

# College B: its own tenant, department, batch and one student.
status, payload = http("POST", "/tenant/v1/tenants", {"slug": f"iso-{run}", "legal_name": f"Isolation {run}", "display_name": f"Isolation {run}"}, admin)
assert status == 201, (status, payload)
tenant_b = json.loads(payload)["id"]
status, payload = http("POST", f"/tenant/v1/tenants/{tenant_b}/departments", {"code": "ISO", "name": "Isolation dept"}, admin)
assert status == 201, (status, payload)
department_b = json.loads(payload)["id"]
status, payload = http("POST", f"/tenant/v1/tenants/{tenant_b}/batches", {"department_id": department_b, "code": f"B{run}".upper(), "name": "Iso batch", "academic_year": "2026-2027"}, admin)
assert status == 201, (status, payload)
batch_b = json.loads(payload)["id"]
organizations = get("/tenant/v1/placement-organizations")["items"]
placement = get(f"/tenant/v1/placement-organizations/{organizations[0]['id']}/departments")["items"][0]["id"]
time.sleep(6)  # the batch reaches the user service over NATS
status, payload = http("POST", f"/user/v1/tenants/{tenant_b}/students/import", {"batch_id": batch_b, "college_department_id": department_b, "placement_department_id": placement, "students": [{"roll_number": f"ISO{run}".upper(), "name": "Isolated Student"}]}, admin)
assert status == 201, (status, payload)
student_b = json.loads(payload)["imported"][0]

# Callers from college A.
status, payload = http("POST", f"/user/v1/tenants/{tenant_a}/staff", {"username": f"iso.{run}", "display_name": "Iso Staff", "role": "department_user", "department_id": department_a}, admin)
faculty_a = login(f"iso.{run}", json.loads(payload)["password"])
students_a = get(f"/user/v1/tenants/{tenant_a}/students")["items"]
principal_a = students_a[0]["principal_id"]
status, payload = http("POST", f"/user/v1/tenants/{tenant_a}/accounts/{principal_a}/password", token=admin)
reset = json.loads(payload)
student_a = login(students_a[0].get("enrollment_number") or reset.get("username"), reset["password"])

ids_b = {"tenant_id": tenant_b, "department_id": department_b, "batch_id": batch_b, "student_id": student_b.get("student_id") or student_b.get("id") or str(uuid.uuid4())}
# Positive control: the data really is there, so an empty answer for the others means refusal.
roster_b = get(f"/user/v1/tenants/{tenant_b}/students")
assert roster_b and roster_b["items"], f"the administrator should see college B's student: {roster_b}"
callers = [("faculty of A", faculty_a), ("student of A", student_a), ("anonymous", None)]
leaks, checked = [], 0
for spec in sorted(glob.glob(os.path.join(ROOT, "*", "api", "openapi.yaml"))):
    service = spec.split(os.sep)[-3]
    if service in ("gateway", "judge"):
        continue
    document = yaml.safe_load(open(spec))
    for path, methods in (document.get("paths") or {}).items():
        if "{tenant_id}" not in path:
            continue
        for method in methods:
            if method not in ("get", "post", "put", "patch", "delete"):
                continue
            url = "/" + service + re.sub(r"\{([a-z_]+)\}", lambda m: ids_b.get(m.group(1), str(uuid.uuid4())), path)
            for name, token in callers:
                body = None if method in ("get", "delete") else {}
                status, payload = http(method.upper(), url, body, token)
                checked += 1
                text = payload.decode("utf-8", "ignore")
                if status >= 500 or status == 0:
                    leaks.append(f"{name} {method.upper()} {url} -> {status}")
                elif status < 300:
                    # A 2xx is only acceptable for a read that returns nothing of B's.
                    try:
                        data = json.loads(text) if text else None
                    except ValueError:
                        data = text
                    empty = data in (None, {}, [], "") or (isinstance(data, dict) and not any(data.get(k) for k in data if k != "next_cursor"))
                    if method != "get" or not empty:
                        leaks.append(f"{name} {method.upper()} {url} -> {status} {text[:120]!r}")

print(f"{checked} cross-college calls made")
if leaks:
    print("\n".join(sorted(set(leaks))))
    sys.exit(f"FAIL {len(set(leaks))} cross-college problems")
print("PASS college isolation")
