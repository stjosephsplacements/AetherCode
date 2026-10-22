import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Me, Principal } from "@/lib/api-types";
import { type Viewer, buildViewer } from "@/lib/viewer";
import { secureCookies } from "./config";
import { gateway } from "./gateway";
import { ACCESS_COOKIE, REFRESH_COOKIE, VIEWER_COOKIE, accessSubject, PASSWORD_COOKIE } from "./tokens";

/** Reads who the access token belongs to from User and Identity. */
export async function fetchViewer(token: string): Promise<Viewer> {
  const subject = accessSubject(token);
  if (!subject) throw new Error("access token has no subject");
  const [me, principal] = await Promise.all([
    gateway<Me>("/user/v1/me", { token }),
    gateway<Principal>(`/identity/v1/principals/${subject}`, { token }),
  ]);
  return buildViewer(me, principal);
}

/**
 * The signed-in viewer, or a redirect to /login. The viewer is cached in a
 * cookie at sign-in; it only shapes navigation, since every service checks
 * permissions itself on each request.
 */
export async function requireViewer(): Promise<Viewer> {
  const jar = await cookies();
  const token = jar.get(ACCESS_COOKIE)?.value;
  if (!token) redirect("/login");
  const cached = jar.get(VIEWER_COOKIE)?.value;
  if (cached) {
    try {
      const viewer = JSON.parse(cached) as Viewer;
      if (viewer.principalId === accessSubject(token)) return viewer;
    } catch {
      // Fall through and read it again.
    }
  }
  return fetchViewer(token);
}

export async function storeViewer(viewer: Viewer, expires: Date) {
  (await cookies()).set({
    name: VIEWER_COOKIE,
    value: JSON.stringify(viewer),
    httpOnly: true,
    secure: secureCookies(),
    sameSite: "strict",
    path: "/",
    expires,
  });
}

export async function clearSession() {
  const jar = await cookies();
  for (const name of [ACCESS_COOKIE, REFRESH_COOKIE, VIEWER_COOKIE, PASSWORD_COOKIE]) jar.delete(name);
}
