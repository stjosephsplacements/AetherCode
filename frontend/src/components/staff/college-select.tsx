"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Select } from "@/components/staff/form";

/**
 * Which college this page is about, for a root administrator. Picking one points the
 * console at it and returns to this same page through /staff/switch.
 */
export function CollegeSelect({ colleges, current, allowAll }: { colleges: { id: string; name: string }[]; current: string; allowAll: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams().toString();
  return (
    <div className="mb-5 flex items-center gap-3">
      <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-subtle">College</span>
      <Select
        aria-label="College"
        size="sm"
        className="w-64"
        value={current}
        onValueChange={(next) => router.push(`/staff/switch?college=${encodeURIComponent(next)}&next=${encodeURIComponent(search ? `${pathname}?${search}` : pathname)}`)}
      >
        {allowAll && <option value="all">All colleges</option>}
        {colleges.map((college) => (
          <option key={college.id} value={college.id}>
            {college.name}
          </option>
        ))}
      </Select>
    </div>
  );
}
