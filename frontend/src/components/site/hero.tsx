import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { SITE } from "@/lib/site";
import { ExamPreview } from "./exam-preview";

/** The headline, two next steps, and the exam screen itself, which flattens from a tilt as you scroll. */
export function Hero() {
  return (
    <section className="relative isolate overflow-hidden">
      <div aria-hidden className="absolute inset-x-0 top-0 -z-10 h-[640px] bg-[radial-gradient(60%_60%_at_50%_0%,var(--glow-2),transparent_70%)]" />
      <div aria-hidden className="absolute inset-0 -z-10 bg-[linear-gradient(to_right,var(--line)_1px,transparent_1px)] bg-[size:120px_100%] [mask-image:linear-gradient(to_bottom,black,transparent_70%)]" />

      <div className="mx-auto max-w-6xl px-6 pt-20 text-center sm:pt-28">
        <a
          href={SITE.repo}
          data-reveal
          className="inline-flex items-center gap-2 rounded-full border border-line-strong bg-surface px-3 py-1 text-[13px] text-ink-muted transition-colors hover:text-ink"
        >
          Open source under the {SITE.license}
          <ArrowRight className="size-3.5" />
        </a>
        <h1 data-split className="mx-auto mt-6 max-w-[14ch] text-balance text-[3rem] font-bold leading-[1.02] tracking-[-0.045em] text-ink sm:text-[4.6rem] lg:text-[5.4rem]">
          {SITE.tagline}
        </h1>
        <p data-reveal className="mx-auto mt-6 max-w-[36rem] text-[17px] leading-[1.6] text-ink-muted sm:text-[18px]">
          Coding exams and practice for colleges: a real editor in six languages, sandboxed judging, Safe Exam Browser lockdown and
          results staff release when they&apos;re ready.
        </p>
        <div data-reveal className="mt-9 flex flex-wrap justify-center gap-3">
          <Button asChild size="lg" className="rounded-[10px]">
            <Link href="/login">Sign in to your exams</Link>
          </Button>
          <Button asChild size="lg" variant="secondary" className="rounded-[10px]">
            <Link href="/system-check">Check my laptop</Link>
          </Button>
        </div>
      </div>

      <div className="mx-auto mt-16 max-w-6xl px-4 pb-16 sm:mt-20 sm:px-6 [perspective:1800px]">
        <div data-tilt className="origin-top">
          <ExamPreview />
        </div>
      </div>
    </section>
  );
}
