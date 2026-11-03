import { Stack, SignOut } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { signOutAction } from "@/app/login/actions";
import type { Viewer } from "@/lib/session";

/** The page frame: brand, who is signed in, and a way out. */
export function Shell({ viewer, children }: { viewer: Viewer; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-6xl px-5 pb-20">
      <header className="flex items-center justify-between gap-4 py-5">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="grid size-9 place-items-center rounded-full bg-brand-soft text-brand">
            <Stack className="size-[18px]" weight="duotone" />
          </span>
          <span className="text-[15px] font-semibold tracking-tight">
            AetherCode <span className="font-normal text-ink-muted">question intake</span>
          </span>
        </Link>
        <form action={signOutAction} className="flex items-center gap-3 text-[13px] text-ink-muted">
          <span>{viewer.name}</span>
          <button className="inline-flex items-center gap-1.5 rounded-full border border-line-strong px-3 py-1.5 transition-colors hover:bg-hover hover:text-ink">
            <SignOut className="size-3.5" />
            Sign out
          </button>
        </form>
      </header>
      <main>{children}</main>
    </div>
  );
}
