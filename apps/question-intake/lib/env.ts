import "server-only";

export function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export const gatewayUrl = () => required("GATEWAY_URL").replace(/\/+$/, "");
export const secureCookies = () => process.env.SECURE_COOKIES === "true";
