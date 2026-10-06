import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { buildSebConfig, isSebConfigKeyRequest, sebConfigKey } from "./seb.ts";

const origin = "http://localhost:3000";

test("buildSebConfig is gzip(plnd + gzip(plist)) pointing at the origin", () => {
  const outer = gunzipSync(buildSebConfig(origin));
  assert.equal(outer.subarray(0, 4).toString(), "plnd");
  const plist = gunzipSync(outer.subarray(4)).toString("utf8");
  assert.match(plist, /<key>startURL<\/key>\s*<string>http:\/\/localhost:3000\/seb\/start<\/string>/);
  assert.match(plist, /<key>browserViewMode<\/key>\s*<integer>1<\/integer>/);
  assert.match(plist, /<key>showTaskBar<\/key>\s*<true\/>/);
  assert.match(plist, /<key>taskBarHeight<\/key>\s*<integer>40<\/integer>/);
  assert.match(plist, /<key>startURLAppendQueryParameter<\/key>\s*<true\/>/);
  assert.match(plist, /<key>quitURL<\/key>\s*<string>http:\/\/localhost:3000\/student\?seb=quit<\/string>/);
});

test("the Config Key is deterministic per origin", () => {
  assert.equal(sebConfigKey(origin), sebConfigKey(origin));
  assert.notEqual(sebConfigKey(origin), sebConfigKey("https://exam.example.edu"));
});

test("isSebConfigKeyRequest accepts SHA256(url + configKey) for the exact URL only", () => {
  const url = `${origin}/exam/0f6c1d9e-1111-4222-8333-944455556666`;
  const hash = createHash("sha256").update(url + sebConfigKey(origin)).digest("hex");
  assert.equal(isSebConfigKeyRequest(url, hash, origin), true);
  assert.equal(isSebConfigKeyRequest(`${url}#top`, hash.toUpperCase(), origin), true);
  assert.equal(isSebConfigKeyRequest(`${url}?seb=reload`, hash, origin), false);
  assert.equal(isSebConfigKeyRequest(url, hash, "https://exam.example.edu"), false);
  assert.equal(isSebConfigKeyRequest(url, null, origin), false);
});
