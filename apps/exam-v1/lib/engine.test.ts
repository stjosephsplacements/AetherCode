import { test } from "node:test";
import assert from "node:assert/strict";
import { readVerdictEvent } from "./engine.ts";

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

const verdict = JSON.stringify({ type: "VERDICT", data: { verdict: "accepted", results: [{ test_index: 0, verdict: "accepted", cpu_time_ns: 1, memory_bytes: 1, stdout: "42\n" }] } });

test("readVerdictEvent finds VERDICT after other events", async () => {
  const result = await readVerdictEvent(streamOf([`event: QUEUED\ndata: {}\n\n: heartbeat\n\nevent: VERDICT\ndata: ${verdict}\n\n`]));
  assert.equal(result?.results?.[0].stdout, "42\n");
});

test("readVerdictEvent keeps state when an event is split across chunks", async () => {
  const text = `event: VERDICT\ndata: ${verdict}\n\n`;
  const result = await readVerdictEvent(streamOf([text.slice(0, 9), text.slice(9, 30), text.slice(30)]));
  assert.equal(result?.verdict, "accepted");
});

test("readVerdictEvent handles CRLF line endings", async () => {
  const result = await readVerdictEvent(streamOf([`event: VERDICT\r\ndata: ${verdict}\r\n\r\n`]));
  assert.equal(result?.verdict, "accepted");
});

test("readVerdictEvent returns null when the stream ends without a verdict", async () => {
  assert.equal(await readVerdictEvent(streamOf(["event: RUNNING\ndata: {}\n\n"])), null);
});
