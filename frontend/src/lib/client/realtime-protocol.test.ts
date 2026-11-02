import { describe, expect, it } from "vitest";
import { backoff, parseMessage, realtimeURL } from "./realtime-protocol";

describe("parseMessage", () => {
  it("accepts hints for known topics and health snapshots", () => {
    expect(parseMessage('{"type":"changed","topic":"attempts","id":"a1","at":"2026-11-01T10:00:00Z"}')).toMatchObject({ topic: "attempts" });
    expect(parseMessage('{"type":"health","checked_at":"2026-11-01T10:00:00Z","services":[]}')).toMatchObject({ type: "health" });
  });

  it("ignores unknown topics, bad JSON and binary frames", () => {
    expect(parseMessage('{"type":"changed","topic":"passwords"}')).toBeNull();
    expect(parseMessage("not json")).toBeNull();
    expect(parseMessage(new ArrayBuffer(4))).toBeNull();
  });
});

describe("realtimeURL", () => {
  it("follows the page's scheme and host", () => {
    expect(realtimeURL({ protocol: "https:", host: "exam.example.edu" }, "t1")).toBe("wss://exam.example.edu/api/realtime?tenant=t1");
    expect(realtimeURL({ protocol: "http:", host: "localhost:3000" }, "t1")).toBe("ws://localhost:3000/api/realtime?tenant=t1");
  });

  it("uses a configured URL when given", () => {
    expect(realtimeURL({ protocol: "http:", host: "localhost:3000" }, "t1", "ws://localhost:8380/api/realtime")).toBe("ws://localhost:8380/api/realtime?tenant=t1");
  });

  it("swaps a localhost address for the page's host when opened from another machine", () => {
    expect(realtimeURL({ protocol: "http:", host: "192.168.1.24:3000" }, "t1", "ws://localhost:8390/api/realtime")).toBe("ws://192.168.1.24:8390/api/realtime?tenant=t1");
    expect(realtimeURL({ protocol: "https:", host: "exam.example.edu" }, "t1", "wss://gateway.example.edu/api/realtime")).toBe("wss://gateway.example.edu/api/realtime?tenant=t1");
  });
});

describe("backoff", () => {
  it("doubles from one second and stops at thirty", () => {
    expect(backoff(0, () => 1)).toBe(1000);
    expect(backoff(3, () => 1)).toBe(8000);
    expect(backoff(10, () => 1)).toBe(30_000);
    expect(backoff(10, () => 0)).toBe(15_000);
  });
});
