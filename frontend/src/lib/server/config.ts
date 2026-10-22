import "server-only";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not set; see frontend/README.md`);
  return value;
}

/** Where the Next.js server reaches the platform gateway, e.g. http://gateway:8080. */
export function gatewayURL(): string {
  return required("GATEWAY_URL").replace(/\/+$/, "");
}

/**
 * The origin students load the site from, e.g. https://exam.example.edu. It
 * must equal the gateway's GATEWAY_SEB_PUBLIC_ORIGIN: Safe Exam Browser hashes
 * request URLs against it. Mutating requests must also come from it.
 */
export function publicOrigin(): string {
  return required("PUBLIC_ORIGIN").replace(/\/+$/, "");
}

export function secureCookies(): boolean {
  return publicOrigin().startsWith("https://");
}
