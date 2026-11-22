import "server-only";
import { cookies, headers } from "next/headers";

export type Theme = "dark" | "light";

/** The theme the viewer picked; light unless they chose dark. The landing page is always dark. */
export async function readTheme(): Promise<Theme> {
  if ((await headers()).get("x-aether-pathname") === "/") return "dark";
  return (await cookies()).get("aether-theme")?.value === "dark" ? "dark" : "light";
}
