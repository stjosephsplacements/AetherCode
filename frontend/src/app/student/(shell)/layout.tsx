import { redirect } from "next/navigation";
import { RealtimeProvider } from "@/lib/client/realtime";
import { StudentShell } from "@/components/student/student-shell";
import { brandFor } from "@/lib/server/branding";
import { requireViewer } from "@/lib/server/session";
import { isStaff, isStudent } from "@/lib/viewer";

export default async function StudentLayout({ children }: { children: React.ReactNode }) {
  const viewer = await requireViewer();
  if (!isStudent(viewer) && isStaff(viewer)) redirect("/staff");
  return (
    <RealtimeProvider tenantId={viewer.tenantId}>
      <StudentShell viewer={viewer} brand={await brandFor(viewer.tenantId)}>
        {children}
      </StudentShell>
    </RealtimeProvider>
  );
}
