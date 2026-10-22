import { logoFor } from "@/lib/server/branding";

/**
 * The signed-in college's logo (ADR-0045). The file comes from the operator's
 * branding file by configured name, never from the request. An SVG is served
 * sandboxed so opening it directly cannot run script.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const index = Number(params.get("n") ?? 0);
  const logo = Number.isInteger(index) && index >= 0 && index < 5 ? await logoFor(params.get("tenant"), index) : null;
  if (!logo) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(logo.data), {
    headers: {
      "content-type": logo.type,
      "cache-control": "private, max-age=300",
      "x-content-type-options": "nosniff",
      "content-security-policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'",
    },
  });
}
