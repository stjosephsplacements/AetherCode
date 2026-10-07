import { EventEmitter } from "node:events";
import { listen } from "./db.ts";

const emitter = new EventEmitter();
emitter.setMaxListeners(0);
let connected = false;

function ensureListening() {
  if (connected) return;
  connected = true;
  listen("submission_done", (payload) => emitter.emit("done", payload)).catch(() => {
    connected = false;
  });
}

export function onSubmissionDone(id: string, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    ensureListening();
    const handler = (payload: string) => {
      if (payload === id) {
        cleanup();
        resolve();
      }
    };
    const onAbort = () => {
      cleanup();
      reject(signal.reason);
    };
    const cleanup = () => {
      emitter.off("done", handler);
      signal.removeEventListener("abort", onAbort);
    };
    emitter.on("done", handler);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
