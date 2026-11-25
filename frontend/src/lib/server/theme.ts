import "server-only";
import { cookies } from "next/headers";

export type Theme = "dark" | "light";

/** The theme the viewer picked; light unless they chose dark. */
export async function readTheme(): Promise<Theme> {
  return (await cookies()).get("aether-theme")?.value === "dark" ? "dark" : "light";
}
