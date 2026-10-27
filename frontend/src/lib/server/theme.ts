import "server-only";
import { cookies } from "next/headers";

export type Theme = "dark" | "light";

/** The theme the viewer picked; dark (Dusk) unless they chose light. */
export async function readTheme(): Promise<Theme> {
  return (await cookies()).get("aether-theme")?.value === "light" ? "light" : "dark";
}
