import { redirect } from "next/navigation";

export default function MyResultsRedirect() {
  redirect("/student/completed");
}
