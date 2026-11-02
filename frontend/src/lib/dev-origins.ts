/**
 * Extra origins the site may be opened from while developing, such as a laptop on the same network
 * (DEV_ORIGINS=http://192.168.1.24:3000,http://localhost:3000). Always empty in production, where
 * PUBLIC_ORIGIN is the one origin.
 */
export function devOrigins(): string[] {
  if (process.env.NODE_ENV === "production") return [];
  return (process.env.DEV_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}
