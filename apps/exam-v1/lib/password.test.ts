import { test } from "node:test";
import assert from "node:assert/strict";
import { generatePassword, hashPassword, verifyPassword } from "./password.ts";

test("password hashing round-trips and rejects wrong input", async () => {
  const hash = await hashPassword("s3cret-pass");
  assert.equal(await verifyPassword("s3cret-pass", hash), true);
  assert.equal(await verifyPassword("wrong", hash), false);
  assert.equal(await verifyPassword("s3cret-pass", "garbage"), false);
  assert.notEqual(await hashPassword("s3cret-pass"), hash);
});

test("generated passwords avoid ambiguous characters", () => {
  const value = generatePassword(200);
  assert.equal(value.length, 200);
  assert.doesNotMatch(value, /[0O1lI]/);
});
