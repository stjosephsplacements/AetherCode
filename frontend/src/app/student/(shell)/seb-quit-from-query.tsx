"use client";

import { useSearchParams } from "next/navigation";
import { SebQuitPanel } from "@/components/student/seb-quit-panel";

export function SebQuitFromQuery({ tenantId }: { tenantId: string | null }) {
  const searchParams = useSearchParams();
  return <SebQuitPanel tenantId={tenantId} visible={searchParams.get("seb") === "quit"} />;
}