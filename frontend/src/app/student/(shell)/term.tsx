import Link from "next/link";
import { cn } from "@/lib/utils";

/** The landing page's bracketed buttons: a filled primary and an outlined secondary, both with a hard shadow. */
export function TermLink({ href, children, primary = false, className }: { href: string; children: React.ReactNode; primary?: boolean; className?: string }) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-block whitespace-nowrap px-5 py-3 font-mono text-[14px] shadow-[4px_4px_0_var(--ink)] transition-transform hover:-translate-x-0.5 hover:-translate-y-0.5",
        primary ? "bg-brand text-brand-ink" : "border border-ink bg-canvas text-ink",
        className,
      )}
    >
      [ {children} ]
    </Link>
  );
}

/** A comment-style section label: "// coming up". */
export function Eyebrow({ children, action }: { children: string; action?: React.ReactNode }) {
  return (
    <div className="mb-2.5 flex items-end justify-between gap-3">
      <h2 className="font-mono text-[13px] text-ink-muted">
        [ {children} ]
      </h2>
      {action}
    </div>
  );
}
