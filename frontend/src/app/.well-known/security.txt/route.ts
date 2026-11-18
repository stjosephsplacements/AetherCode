import { contacts } from "@/lib/server/contacts";
import { publicOrigin } from "@/lib/server/config";

// RFC 9116. Expires is required; a year ahead, recomputed on each request.
export function GET() {
  const { security } = contacts();
  const origin = publicOrigin();
  const expires = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
  const lines = [
    // RFC 9116 needs at least one contact: the email when configured, otherwise the policy page.
    `Contact: ${security ? `mailto:${security}` : `${origin}/security`}`,
    `Expires: ${expires}`,
    "Preferred-Languages: en",
    `Canonical: ${origin}/.well-known/security.txt`,
    `Policy: ${origin}/security`,
  ];
  return new Response(`${lines.join("\n")}\n`, { headers: { "content-type": "text/plain; charset=utf-8" } });
}
