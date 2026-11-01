"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useRef } from "react";
import { Select } from "@/components/staff/form";

/**
 * Which college this page is about, for a root administrator. Picking one comes back
 * to this same page through /staff/switch.
 *
 * It is a real GET form, so the browser does a full page load. The switch sets a cookie
 * on a redirect, and the in-page router (router.push) does not re-render the page it
 * ends up on, so the old college stayed on screen until a refresh.
 */
export function CollegeSelect({ colleges, current, allowAll }: { colleges: { id: string; name: string }[]; current: string; allowAll: boolean }) {
  const form = useRef<HTMLFormElement>(null);
  const pathname = usePathname();
  const search = useSearchParams().toString();
  return (
    <form ref={form} method="get" action="/staff/switch" className="mb-5 flex items-center gap-3">
      <input type="hidden" name="next" value={search ? `${pathname}?${search}` : pathname} />
      <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-subtle">College</span>
      <Select name="college" aria-label="College" size="sm" className="w-64" value={current} onValueChange={() => form.current?.requestSubmit()}>
        {allowAll && <option value="all">All colleges</option>}
        {colleges.map((college) => (
          <option key={college.id} value={college.id}>
            {college.name}
          </option>
        ))}
      </Select>
    </form>
  );
}
