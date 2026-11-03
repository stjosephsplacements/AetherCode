import assert from "node:assert/strict";
import { test } from "node:test";

import { loginName } from "./login-name.ts";

test("the @stjosephs suffix is dropped, other identifiers are left alone", () => {
  assert.equal(loginName("hope1@stjosephs"), "hope1");
  assert.equal(loginName(" HOPE2@StJosephs "), "HOPE2");
  assert.equal(loginName("staff@example.org"), "staff@example.org");
  assert.equal(loginName("hope3"), "hope3");
});
