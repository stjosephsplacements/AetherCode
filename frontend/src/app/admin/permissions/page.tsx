import type { Metadata } from "next";
import { PermissionsScreen } from "@/app/staff/permissions/screen";

export const metadata: Metadata = { title: "Permissions" };

/** Platform permissions stay in the admin shell — not `/staff/permissions`. */
export default function AdminPermissionsPage({ searchParams }: { searchParams: Promise<{ person?: string; scope?: string; college?: string }> }) {
  return <PermissionsScreen basePath="/admin/permissions" searchParams={searchParams} defaultScope="platform" />;
}
