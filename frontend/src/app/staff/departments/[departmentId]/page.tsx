import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/server/staff";

/** Old deep links land on the batches page with that department selected. */
export default async function DepartmentRedirect({ params }: { params: Promise<{ departmentId: string }> }) {
  const staff = await requireStaff();
  if (!staff.canManageAccounts) redirect("/staff");
  const { departmentId } = await params;
  redirect(`/staff/departments/batches?department=${encodeURIComponent(departmentId)}`);
}
