import { ArrowLeft } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { redirect } from "next/navigation";
import { staffNavGroups } from "@/components/staff/staff-nav-groups";
import { StaffShell } from "@/components/staff/staff-shell";
import { brandFor } from "@/lib/server/branding";
import { lockedPages, setupSteps } from "@/lib/server/setup";
import { requireStaff } from "@/lib/server/staff";
import { GetStarted } from "./get-started";

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const staff = await requireStaff();
  // A platform administrator works across colleges in /admin; /staff is one college's workspace,
  // opened on purpose from there (/admin/open).
  if (staff.isPlatformAdmin && !staff.tenantId) redirect("/admin");
  const steps = staff.canManageAccounts ? await setupSteps(staff) : [];
  const locks = lockedPages(steps);
  const groups = staffNavGroups({ canManageAccounts: staff.canManageAccounts, locks });
  return (
    <StaffShell
      viewer={staff.viewer}
      tenantId={staff.tenantId}
      groups={groups}
      brand={await brandFor(staff.tenantId)}
      college={
        staff.isPlatformAdmin ? (
          <Link href="/admin" className="flex items-center gap-2 rounded-[var(--radius-control)] border border-line px-2.5 py-1.5 text-[13px] text-ink-muted transition-colors hover:bg-hover hover:text-ink">
            <ArrowLeft className="size-3.5" />
            Back to admin
          </Link>
        ) : undefined
      }
    >
      {children}
      {steps.length > 0 && <GetStarted steps={steps.map(({ key, title, text, href, done, blocked }) => ({ key, title, text, href, done, blocked }))} userId={staff.viewer.principalId} />}
    </StaffShell>
  );
}
