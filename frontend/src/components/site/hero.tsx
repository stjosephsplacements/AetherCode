import { CircleHelp, Laptop, ShieldCheck, Activity } from "lucide-react";
import Link from "next/link";
import { SITE } from "@/lib/site";
import { RollBox } from "./roll-box";

const SHORTCUTS = [
  { href: "/system-check", label: "Check my laptop", icon: Laptop },
  { href: "/help", label: "Help center", icon: CircleHelp },
  { href: "/status", label: "Status", icon: Activity },
  { href: "/security", label: "Security", icon: ShieldCheck },
];

/** The headline, the roll-number box that starts sign-in, and shortcuts to what students ask for most before an exam. */
export function Hero() {
  return (
    <section className="mx-auto flex min-h-[calc(100svh-56px)] max-w-6xl flex-col items-center justify-center px-6 py-20 text-center">
      <h1 data-split className="heading text-[3rem] text-ink sm:text-[4.4rem] lg:text-[5rem]">
        {SITE.tagline}
      </h1>
      <p data-reveal className="mt-4 text-[17px] text-ink-muted">
        Coding exams and practice for colleges, open source and self-hosted.
      </p>
      <div data-reveal className="mt-10 w-full">
        <RollBox />
      </div>
      <nav data-reveal aria-label="Before your exam" className="mt-8 flex flex-wrap justify-center gap-3">
        {SHORTCUTS.map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href} className="group flex w-[104px] flex-col items-center gap-2 text-[12.5px] text-ink-muted transition-colors hover:text-ink">
            <span className="grid size-11 place-items-center rounded-[12px] border border-line-strong bg-surface transition-colors group-hover:border-ink-subtle">
              <Icon className="size-[18px]" strokeWidth={1.6} />
            </span>
            {label}
          </Link>
        ))}
      </nav>
    </section>
  );
}
