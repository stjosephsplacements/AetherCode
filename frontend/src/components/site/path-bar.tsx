"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Under the navbar on inner public pages: where you are, as a shell prompt, and the way home. */
export function PathBar() {
  const pathname = usePathname();
  if (pathname === "/") return null;
  return (
    <div className="mx-auto flex max-w-6xl border-b border-line font-mono text-[12.5px] lg:border-x">
      <p className="px-5 py-2 text-ink-muted">
        <span className="text-brand">$ </span>cd ~{pathname}
      </p>
      <Link href="/" className="ml-auto border-l border-line px-4 py-2 text-ink-muted transition-colors hover:bg-brand hover:text-brand-ink">
        [&lt;- home]
      </Link>
    </div>
  );
}
