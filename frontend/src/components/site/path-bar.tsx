"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Under the navbar on inner public pages: where you are, and the way home. */
export function PathBar() {
  const pathname = usePathname();
  if (pathname === "/") return null;
  return (
    <div className="mx-auto mt-4 flex max-w-6xl items-center gap-2 px-6 font-mono text-[12.5px]">
      <Link href="/" className="rounded-full border border-line bg-surface px-3 py-1 text-ink-muted transition-colors hover:bg-hover hover:text-ink">
        &larr; Home
      </Link>
      <p className="rounded-full border border-line bg-surface px-3 py-1 text-ink-muted">~{pathname}</p>
    </div>
  );
}
