import { test } from "node:test";
import assert from "node:assert/strict";
import { ipAllowed, isValidNetwork, normalizeClientIp } from "./net.ts";

test("ipAllowed", () => {
  const cases: Array<[string | null, string[], boolean]> = [
    ["10.20.3.4", [], true],
    ["10.20.3.4", ["10.20.0.0/16"], true],
    ["10.21.3.4", ["10.20.0.0/16"], false],
    ["192.168.1.77", ["10.0.0.0/8", "192.168.1.0/24"], true],
    ["192.168.1.77", ["192.168.1.77"], true],
    ["192.168.1.78", ["192.168.1.77"], false],
    ["8.8.8.8", ["0.0.0.0/0"], true],
    [null, ["10.0.0.0/8"], false],
    ["fe80::1", ["10.0.0.0/8"], false],
  ];
  for (const [ip, networks, want] of cases) assert.equal(ipAllowed(ip, networks), want, `${ip} in ${networks}`);
});

test("isValidNetwork", () => {
  for (const good of ["10.0.0.0/8", "192.168.1.5", "0.0.0.0/0", " 172.16.0.0/12 "]) assert.equal(isValidNetwork(good), true, good);
  for (const bad of ["10.0.0/8", "10.0.0.0/33", "256.1.1.1", "lab", "10.0.0.0/8/1", "fe80::/10"]) assert.equal(isValidNetwork(bad), false, bad);
});

test("normalizeClientIp", () => {
  assert.equal(normalizeClientIp("::ffff:10.1.2.3"), "10.1.2.3");
  assert.equal(normalizeClientIp("10.1.2.3, 172.18.0.1"), "10.1.2.3");
  assert.equal(normalizeClientIp(""), null);
  assert.equal(normalizeClientIp(null), null);
});
