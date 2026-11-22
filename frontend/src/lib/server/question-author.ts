import "server-only";
import { redirect } from "next/navigation";
import { homeFor, isStaff, type Viewer } from "@/lib/viewer";
import { requireViewer } from "./session";

/** College staff or placement officers may author the shared question bank. */
export async function requireQuestionAuthor(): Promise<Viewer> {
  const viewer = await requireViewer();
  if (isStaff(viewer) || viewer.roles.includes("placement_user")) return viewer;
  redirect(homeFor(viewer));
}
