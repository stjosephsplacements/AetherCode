import { randomBytes } from "node:crypto";
import { gatewayURL } from "@/lib/server/config";

const NO_STORE = { "cache-control": "no-store" };
const DOWNLOAD_BYTES = 512 * 1024;

/**
 * Probes for the system check: `latency` answers at once, `download` sends
 * incompressible bytes for a speed estimate, `platform` reports whether the
 * gateway and the services behind it are ready.
 */
export async function GET(request: Request) {
  const kind = new URL(request.url).searchParams.get("kind");
  if (kind === "download") {
    return new Response(new Uint8Array(randomBytes(DOWNLOAD_BYTES)), {
      headers: { ...NO_STORE, "content-type": "application/octet-stream", "content-length": String(DOWNLOAD_BYTES) },
    });
  }
  if (kind === "platform") {
    const started = performance.now();
    const ok = await fetch(`${gatewayURL()}/readyz`, { cache: "no-store", signal: AbortSignal.timeout(4000) }).then(
      (response) => response.ok,
      () => false,
    );
    return Response.json({ ok, ms: Math.round(performance.now() - started) }, { headers: NO_STORE });
  }
  return new Response(null, { status: 204, headers: NO_STORE });
}
