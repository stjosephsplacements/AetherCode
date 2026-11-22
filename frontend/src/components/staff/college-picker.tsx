"use client";

import { Select } from "@/components/staff/form";
import { collegeHref } from "@/lib/links";

/** The admin sidebar's workspace switcher: picking a college opens its /staff workspace. */
export function CollegePicker({ colleges, selected }: { colleges: { id: string; name: string }[]; selected: string }) {
  return (
    <div>
      <p className="mb-1 font-[family-name:var(--font-eyebrow)] text-[10.5px] uppercase tracking-[0.14em] text-ink-subtle">College workspace</p>
      <Select
        aria-label="College workspace"
        size="sm"
        className="w-full"
        value={selected}
        // A plain navigation: the open route sets the college cookie and redirects.
        onValueChange={(id) => id && id !== selected && window.location.assign(collegeHref("/staff", id))}
      >
        <option value="">Choose a college</option>
        {colleges.map((college) => (
          <option key={college.id} value={college.id}>
            {college.name}
          </option>
        ))}
      </Select>
    </div>
  );
}
