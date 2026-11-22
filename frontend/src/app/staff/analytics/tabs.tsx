import Link from "next/link";
import { cn } from "@/lib/utils";

export function AnalyticsTabs({ tab }: { tab: "overview" | "profiles" }) {
  return (
    <nav className="mb-4 flex gap-2 border-b border-line pb-2 text-sm">
      {(
        [
          { id: "overview", href: "/staff/analytics", label: "Overview" },
          { id: "profiles", href: "/staff/analytics?tab=profiles", label: "Profiles" },
        ] as const
      ).map((entry) => (
        <Link
          key={entry.id}
          href={entry.href}
          className={cn(
            "rounded-md px-3 py-1.5",
            tab === entry.id ? "bg-brand/10 font-semibold text-brand" : "text-ink-muted hover:text-ink",
          )}
        >
          {entry.label}
        </Link>
      ))}
    </nav>
  );
}