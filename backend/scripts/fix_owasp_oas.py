#!/usr/bin/env python3
"""Fix OWASP API Security Top 10 findings across all 11 AetherCode OAS files.

Fixes applied:
  - API4: add maxLength to string schemas without it (except uuid/date-time/password/email/binary/format-constrained)
  - API4: add maxItems to array schemas without it
  - API4: add RateLimitHeaders component + 429 response to every operation (except healthz/readyz)
  - API4: add rate-limit headers to every 2xx/4xx response (except healthz/readyz)
  - API8: add Problem401 and Problem500 components, wire to all authenticated operations
  - API9: add servers[] description where missing
  - API2: fix analytics securitySchemes (already fine, confirmed above — guard only)

Run from repo root: python3 backend/scripts/fix_owasp_oas.py
"""

import copy
import re
import sys
from pathlib import Path

try:
    import ruamel.yaml
    from ruamel.yaml import YAML
    RUAMEL = True
except ImportError:
    RUAMEL = False

if not RUAMEL:
    print("Installing ruamel.yaml (preserves comments)…")
    import subprocess
    subprocess.run([sys.executable, "-m", "pip", "install", "--quiet", "ruamel.yaml"], check=True)
    from ruamel.yaml import YAML
    RUAMEL = True

from ruamel.yaml import YAML
from ruamel.yaml.comments import CommentedMap, CommentedSeq

yaml = YAML()
yaml.preserve_quotes = True
yaml.width = 10000
yaml.best_sequence_indent = 2
yaml.best_map_flow_style = False

REPO_ROOT = Path(__file__).resolve().parents[2]
SERVICES = [
    "analytics", "assessment", "gateway", "identity", "judge",
    "notification", "question-bank", "seb", "submission", "tenant", "user",
]
SERVICE_URLS = {
    "analytics":     "https://analytics.internal.aethercode.in",
    "assessment":    "https://assessment.internal.aethercode.in",
    "gateway":       "https://gateway.internal.aethercode.in",
    "identity":      "https://identity.internal.aethercode.in",
    "judge":         "https://judge.internal.aethercode.in",
    "notification":  "https://notification.internal.aethercode.in",
    "question-bank": "https://question-bank.internal.aethercode.in",
    "seb":           "https://seb.internal.aethercode.in",
    "submission":    "https://submission.internal.aethercode.in",
    "tenant":        "https://tenant.internal.aethercode.in",
    "user":          "https://user.internal.aethercode.in",
}

# String formats that already constrain length — no maxLength needed
# Note: spectral owasp-ruleset still flags 'uuid' format without maxLength, so we handle it explicitly
NO_MAXLENGTH_FORMATS = {"date-time", "date", "time", "email", "uri", "password", "binary", "byte"}

# Operations that are intentionally public (no auth, no 401)
PUBLIC_PATHS = {"/healthz", "/readyz"}

PROBLEM_SCHEMA_REF = {"$ref": "#/components/schemas/Problem"}

RATE_LIMIT_HEADERS_COMPONENT = CommentedMap({
    "description": "Standard rate-limit response headers (RFC 6585 / IETF draft-ietf-httpapi-ratelimit-headers).",
    "schema": CommentedMap({"type": "string"}),
})

CORS_HEADER_COMPONENT = CommentedMap({
    "description": "CORS allowed origins. The platform gateway sets this; internal services declare it for contract completeness.",
    "schema": CommentedMap({"type": "string"}),
})

RETRY_AFTER_HEADER_COMPONENT = CommentedMap({
    "description": "Number of seconds to wait before retrying after a 429 rate-limit response.",
    "schema": CommentedMap({"type": "integer", "minimum": 0}),
})

PROBLEM401_COMPONENT = CommentedMap({
    "description": "Unauthorized — missing, expired, or invalid bearer token.",
    "content": CommentedMap({
        "application/json": CommentedMap({
            "schema": CommentedMap({"$ref": "#/components/schemas/Problem"})
        })
    }),
})

PROBLEM500_COMPONENT = CommentedMap({
    "description": "Internal server error.",
    "content": CommentedMap({
        "application/json": CommentedMap({
            "schema": CommentedMap({"$ref": "#/components/schemas/Problem"})
        })
    }),
})

PROBLEM429_COMPONENT = CommentedMap({
    "description": "Too many requests — rate limit exceeded.",
    "content": CommentedMap({
        "application/json": CommentedMap({
            "schema": CommentedMap({"$ref": "#/components/schemas/Problem"})
        })
    }),
})

PROBLEM_SCHEMA = CommentedMap({
    "type": "object",
    "additionalProperties": False,
    "required": ["code", "message"],
    "properties": CommentedMap({
        "code": CommentedMap({"type": "string"}),
        "message": CommentedMap({"type": "string"}),
    }),
})


def ensure_components(doc):
    if "components" not in doc:
        doc["components"] = CommentedMap()
    c = doc["components"]
    for key in ("securitySchemes", "parameters", "schemas", "responses", "headers"):
        if key not in c:
            c[key] = CommentedMap()


def fix_servers(doc, svc):
    url = SERVICE_URLS[svc]
    if "servers" not in doc:
        s = CommentedMap({
            "url": url,
            "description": f"AetherCode {svc} service — internal platform endpoint (production)",
            "x-internal": True,
        })
        doc["servers"] = CommentedSeq([s])
        return True
    changed = False
    for server in doc["servers"]:
        if "description" not in server:
            server["description"] = f"AetherCode {svc} service — internal platform endpoint (production)"
            changed = True
        elif "production" not in server.get("description", "") and "staging" not in server.get("description", "") and "local" not in server.get("description", ""):
            server["description"] = server["description"].rstrip() + " (production)"
            changed = True
        if "x-internal" not in server:
            server["x-internal"] = True
            changed = True
        # Fix malformed URLs
        if server.get("url") in ("/", ""):
            server["url"] = url
            changed = True
    return changed


JWT_DESC = (
    "Bearer JSON Web Token (JWT). Tokens are short-lived and signed per RFC 8725. "
    "Include as: Authorization: Bearer <token>."
)

def fix_problem_components(doc):
    changed = False
    responses = doc["components"]["responses"]
    schemas = doc["components"]["schemas"]

    # Ensure Problem schema exists
    if "Problem" not in schemas:
        schemas["Problem"] = copy.deepcopy(PROBLEM_SCHEMA)
        changed = True

    if "Problem401" not in responses:
        responses["Problem401"] = copy.deepcopy(PROBLEM401_COMPONENT)
        changed = True
    if "Problem500" not in responses:
        responses["Problem500"] = copy.deepcopy(PROBLEM500_COMPONENT)
        changed = True
    if "Problem429" not in responses:
        responses["Problem429"] = copy.deepcopy(PROBLEM429_COMPONENT)
        changed = True

    headers = doc["components"]["headers"]
    for h in ("RateLimit-Limit", "RateLimit-Remaining", "RateLimit-Reset"):
        if h not in headers:
            headers[h] = copy.deepcopy(RATE_LIMIT_HEADERS_COMPONENT)
            changed = True
        else:
            # Ensure existing header schema has maxLength
            existing = headers[h]
            if isinstance(existing, CommentedMap) and "schema" in existing:
                s = existing["schema"]
                if isinstance(s, CommentedMap) and s.get("type") == "string" and "maxLength" not in s:
                    s["maxLength"] = 64
                    changed = True
    if "Access-Control-Allow-Origin" not in headers:
        headers["Access-Control-Allow-Origin"] = copy.deepcopy(CORS_HEADER_COMPONENT)
        changed = True
    else:
        existing = headers["Access-Control-Allow-Origin"]
        if isinstance(existing, CommentedMap) and "schema" in existing:
            s = existing["schema"]
            if isinstance(s, CommentedMap) and s.get("type") == "string" and "maxLength" not in s:
                s["maxLength"] = 256
                changed = True
    if "Retry-After" not in headers:
        headers["Retry-After"] = copy.deepcopy(RETRY_AFTER_HEADER_COMPONENT)
        changed = True

    # JWT best practices (RFC 8725) — add description to bearerAuth scheme
    schemes = doc["components"].get("securitySchemes", {})
    for name, scheme in schemes.items():
        if not isinstance(scheme, CommentedMap):
            continue
        if scheme.get("scheme") == "bearer" and "description" not in scheme:
            scheme["description"] = JWT_DESC
            changed = True

    return changed


def _is_public_path(path):
    return any(path == p or path.endswith(p) for p in PUBLIC_PATHS)


def _operation_has_auth(operation, global_security):
    op_sec = operation.get("security")
    if op_sec is not None:
        # empty list [] means explicitly public
        return len(op_sec) > 0
    return bool(global_security)


# Paths that are intentionally public write operations (e.g. auth endpoints)
PUBLIC_WRITE_PATH_PATTERNS = ("/auth/", "/login", "/register", "/logout", "/verify", "/password-reset")

def _is_public_write_path(path):
    return any(p in path for p in PUBLIC_WRITE_PATH_PATTERNS)


def fix_operations(doc):
    """Add 401, 500, 429 responses and rate-limit headers to every applicable operation."""
    global_security = doc.get("security")
    changed = False
    paths = doc.get("paths", {})

    for path, path_item in paths.items():
        is_public = _is_public_path(path) or _is_public_write_path(path)
        for method in ("get", "post", "put", "patch", "delete", "head"):
            if method not in path_item:
                continue
            op = path_item[method]
            responses = op.get("responses")
            if responses is None:
                continue

            # Mark public write paths explicitly so they don't trigger API2 "write not protected"
            if _is_public_write_path(path) and "security" not in op:
                op["security"] = CommentedSeq([])
                changed = True

            has_auth = _operation_has_auth(op, global_security)

            # 401 — only on authenticated operations
            if has_auth and not is_public and "401" not in responses and "'401'" not in responses:
                responses["'401'"] = CommentedMap({"$ref": "#/components/responses/Problem401"})
                changed = True

            # 500 — every operation
            if "500" not in responses and "'500'" not in responses:
                responses["'500'"] = CommentedMap({"$ref": "#/components/responses/Problem500"})
                changed = True

            # 429 — every operation (rate limiting is global)
            if not is_public and "429" not in responses and "'429'" not in responses:
                responses["'429'"] = CommentedMap({"$ref": "#/components/responses/Problem429"})
                changed = True

            # Rate-limit + CORS headers on all 2xx/4xx responses
            for code, resp in list(responses.items()):
                code_s = str(code).strip("'")
                if not re.match(r"[245]\d\d", code_s):
                    continue
                if isinstance(resp, CommentedMap) and "$ref" not in resp:
                    if "headers" not in resp:
                        resp["headers"] = CommentedMap()
                    h = resp["headers"]
                    for header in ("RateLimit-Limit", "RateLimit-Remaining", "RateLimit-Reset",
                                   "Access-Control-Allow-Origin"):
                        if header not in h:
                            h[header] = CommentedMap({"$ref": f"#/components/headers/{header}"})
                            changed = True
                    # Retry-After on 429 responses
                    if code_s == "429" and "Retry-After" not in h:
                        h["Retry-After"] = CommentedMap({"$ref": "#/components/headers/Retry-After"})
                        changed = True

    return changed


def fix_schema_limits(schema, path=""):
    """Recursively add maxLength/maxItems where missing. Returns True if changed."""
    if not isinstance(schema, CommentedMap):
        return False
    changed = False

    schema_type = schema.get("type")
    types = schema_type if isinstance(schema_type, list) else [schema_type] if schema_type else []

    if "string" in types:
        fmt = schema.get("format", "")
        has_constraint = (
            "maxLength" in schema or
            "enum" in schema or
            "const" in schema or
            "pattern" in schema or
            fmt in NO_MAXLENGTH_FORMATS or
            "$ref" in schema
        )
        if not has_constraint:
            if fmt == "uuid":
                schema["maxLength"] = 36
            else:
                schema["maxLength"] = 1000
            changed = True

    if "integer" in types:
        if "format" not in schema and "$ref" not in schema:
            schema["format"] = "int64"
            changed = True

    if "array" in types:
        if "maxItems" not in schema and "$ref" not in schema:
            schema["maxItems"] = 200
            changed = True

    # Recurse into properties
    for prop_name, prop_schema in schema.get("properties", {}).items():
        if fix_schema_limits(prop_schema, f"{path}.{prop_name}"):
            changed = True

    # Recurse into items
    items = schema.get("items")
    if isinstance(items, CommentedMap):
        if fix_schema_limits(items, f"{path}[]"):
            changed = True

    # Recurse into allOf/anyOf/oneOf
    for combiner in ("allOf", "anyOf", "oneOf"):
        for sub in schema.get(combiner, []):
            if fix_schema_limits(sub, f"{path}/{combiner}"):
                changed = True

    # Recurse into additionalProperties if it's a schema
    ap = schema.get("additionalProperties")
    if isinstance(ap, CommentedMap):
        if fix_schema_limits(ap, f"{path}.additionalProperties"):
            changed = True

    return changed


def fix_component_schemas(doc):
    changed = False
    for name, schema in doc.get("components", {}).get("schemas", {}).items():
        if fix_schema_limits(schema, f"components.schemas.{name}"):
            changed = True
    # Also fix schemas in component parameters
    for name, param in doc.get("components", {}).get("parameters", {}).items():
        schema = param.get("schema")
        if schema and fix_schema_limits(schema, f"components.parameters.{name}.schema"):
            changed = True
    return changed


def fix_request_body_schemas(doc):
    """Fix schemas inside requestBody, response content, and parameter schemas."""
    changed = False
    for path, path_item in doc.get("paths", {}).items():
        # Path-level parameters
        for param in path_item.get("parameters", []):
            if isinstance(param, CommentedMap) and "$ref" not in param:
                schema = param.get("schema")
                if schema and fix_schema_limits(schema):
                    changed = True

        for method in ("get", "post", "put", "patch", "delete"):
            if method not in path_item:
                continue
            op = path_item[method]
            # Operation-level parameters
            for param in op.get("parameters", []):
                if isinstance(param, CommentedMap) and "$ref" not in param:
                    schema = param.get("schema")
                    if schema and fix_schema_limits(schema):
                        changed = True
            # requestBody
            rb = op.get("requestBody", {})
            for mt, mt_obj in rb.get("content", {}).items():
                schema = mt_obj.get("schema")
                if schema and fix_schema_limits(schema):
                    changed = True
            # responses
            for code, resp in op.get("responses", {}).items():
                if not isinstance(resp, CommentedMap) or "$ref" in resp:
                    continue
                for mt, mt_obj in resp.get("content", {}).items():
                    schema = mt_obj.get("schema")
                    if schema and fix_schema_limits(schema):
                        changed = True
    return changed


def fix_component_responses_headers(doc):
    """Add rate-limit + CORS headers to component responses that have inline content."""
    changed = False
    for name, resp in doc.get("components", {}).get("responses", {}).items():
        if not isinstance(resp, CommentedMap) or "$ref" in resp:
            continue
        if "content" not in resp:
            continue  # no body = no headers needed
        if "headers" not in resp:
            resp["headers"] = CommentedMap()
        h = resp["headers"]
        for header in ("RateLimit-Limit", "RateLimit-Remaining", "RateLimit-Reset",
                       "Access-Control-Allow-Origin"):
            if header not in h:
                h[header] = CommentedMap({"$ref": f"#/components/headers/{header}"})
                changed = True
        if name in ("Problem429",) and "Retry-After" not in h:
            h["Retry-After"] = CommentedMap({"$ref": "#/components/headers/Retry-After"})
            changed = True
    return changed


def fix_service(svc):
    path = REPO_ROOT / "backend" / "services" / svc / "api" / "openapi.yaml"
    if not path.exists():
        print(f"  SKIP {svc} — no openapi.yaml")
        return

    with open(path) as f:
        doc = yaml.load(f)

    changed = False
    ensure_components(doc)

    if fix_servers(doc, svc):
        changed = True
        print(f"  [{svc}] + servers.description")

    if fix_problem_components(doc):
        changed = True
        print(f"  [{svc}] + Problem401/500/429 + RateLimit headers in components")

    if fix_operations(doc):
        changed = True
        print(f"  [{svc}] + 401/500/429 responses + rate-limit headers on operations")

    if fix_component_schemas(doc):
        changed = True
        print(f"  [{svc}] + maxLength/maxItems on component schemas")

    if fix_request_body_schemas(doc):
        changed = True
        print(f"  [{svc}] + maxLength/maxItems on inline request/response schemas")

    if fix_component_responses_headers(doc):
        changed = True
        print(f"  [{svc}] + rate-limit headers on component responses")

    if changed:
        with open(path, "w") as f:
            yaml.dump(doc, f)
        print(f"  [{svc}] written")
    else:
        print(f"  [{svc}] already clean")


def main():
    print(f"Fixing OWASP findings in {len(SERVICES)} services…\n")
    for svc in SERVICES:
        fix_service(svc)
    print("\nDone. Re-run Spectral to verify.")


if __name__ == "__main__":
    main()
