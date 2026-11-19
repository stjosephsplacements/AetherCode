import { contacts } from "@/lib/server/contacts";
import { publicOrigin } from "@/lib/server/config";

// RFC 9116. Expires is required; a year ahead, recomputed on each request.
export function GET() {
  const { security } = contacts();
  const origin = publicOrigin();
  const expires = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
  // RFC 9116 requires a Contact; without a configured SECURITY_EMAIL there is nothing valid to publish.
  if (!security) return new Response("Not found\n", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  const lines = [
    `Contact: mailto:${security}`,
    `Expires: ${expires}`,
    "Preferred-Languages: en",
    `Canonical: ${origin}/.well-known/security.txt`,
    `Policy: ${origin}/security`,
  ];
  return new Response(`${lines.join("\n")}\n`, { headers: { "content-type": "text/plain; charset=utf-8" } });
}
