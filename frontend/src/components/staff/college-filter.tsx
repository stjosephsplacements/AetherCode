"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Select } from "@/components/staff/form";

/** Narrows a list that covers every college to one (`?college=`), like codepro's college filter. */
export function CollegeFilter({ colleges }: { colleges: { id: string; name: string }[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  if (colleges.length < 2) return null;
  return (
    <Select
      aria-label="College"
      size="sm"
      className="w-56"
      value={params.get("college") ?? "all"}
      onValueChange={(next) => {
        const query = new URLSearchParams(params.toString());
        if (next === "all") query.delete("college");
        else query.set("college", next);
        const text = query.toString();
        router.push(text ? `${pathname}?${text}` : pathname);
      }}
    >
      <option value="all">Every college</option>
      {colleges.map((college) => (
        <option key={college.id} value={college.id}>
          {college.name}
        </option>
      ))}
    </Select>
  );
}
