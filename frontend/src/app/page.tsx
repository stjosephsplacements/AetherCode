import { redirect } from "next/navigation";
import { requireViewer } from "@/lib/server/session";
import { homeFor } from "@/lib/viewer";

export default async function Home() {
  redirect(homeFor(await requireViewer()));
}
