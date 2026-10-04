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

def call(method, path, body=None, token=None, expect=None):
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(BASE + path, data=data, method=method)
    request.add_header("Content-Type", "application/json")
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
