import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { brandFor } from "@/lib/server/branding";
import { requireViewer } from "@/lib/server/session";
import { isStaff, isStudent } from "@/lib/viewer";

export default async function StudentLayout({ children }: { children: React.ReactNode }) {
  const viewer = await requireViewer();
  if (!isStudent(viewer) && isStaff(viewer)) redirect("/staff");
  return (
    <AppShell viewer={viewer} brand={await brandFor(viewer.tenantId)} nav={[
          { href: "/student", label: "My exams", icon: "exams" },
          { href: "/student/practice", label: "Practice", icon: "practice" },
          { href: "/student/progress", label: "My progress", icon: "progress" },
          { href: "/student/contests", label: "Contests", icon: "contests" },
          { href: "/student/hackathons", label: "Hackathons", icon: "hackathons" },
          { href: "/student/open-source", label: "Open source", icon: "opensource" },
          { href: "/student/interviews", label: "Interviews", icon: "interviews" },
          { href: "/student/blogs", label: "Blogs", icon: "blogs" },
          { href: "/student/tasks", label: "My tasks", icon: "tasks" },
          { href: "/student/profile", label: "My profile", icon: "profile" },
          { href: "/student/help", label: "Help", icon: "help" },
        ]}>
      {children}
    </AppShell>
  );
}
