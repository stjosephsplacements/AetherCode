import type { Metadata } from "next";
import { PermissionsScreen } from "./screen";

export const metadata: Metadata = { title: "Permissions" };

export default function PermissionsPage({ searchParams }: { searchParams: Promise<{ person?: string; scope?: string; college?: string }> }) {
  return <PermissionsScreen basePath="/staff/permissions" searchParams={searchParams} />;
}
