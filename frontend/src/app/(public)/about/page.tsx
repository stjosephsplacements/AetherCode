import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { contacts } from "@/lib/server/contacts";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: "About",
  description: "Why AetherCode exists: fair coding assessments built by students and the St. Joseph's Placements and Training Cell.",
  alternates: { canonical: "/about" },
};

const STATS = [
  { value: SITE.stats.students, label: "students assessed" },
  { value: SITE.stats.runs, label: "code runs judged" },
  { value: String(SITE.languages.length), label: "languages supported" },
];

// The contact comes from the environment at start-up, not from the image build.
export const dynamic = "force-dynamic";

export default function AboutPage() {
  const { support } = contacts();
  return (
    <div className="mx-auto max-w-6xl px-6 pb-24 pt-14 sm:pt-20">
      <div className="max-w-[46rem]">
        <h1 className="display text-[2.8rem] text-ink sm:text-[4rem]">{SITE.tagline}</h1>
        <p className="mt-6 text-[17px] leading-[1.75] text-ink-muted">
          A placement shouldn&apos;t depend on which college you went to or who you know. It should depend on whether you can
          solve the problem in front of you. AetherCode gives every student the same exam, the same judge and the same fair shot.
        </p>
      </div>

      <dl className="mt-16 grid gap-px overflow-hidden rounded-surface border border-line bg-line sm:grid-cols-3">
        {STATS.map((stat) => (
          <div key={stat.label} className="bg-surface px-8 py-8">
            <dt className="text-[14px] text-ink-muted">{stat.label}</dt>
            <dd className="mt-1 font-serif text-[3rem] leading-none text-ink">{stat.value}</dd>
          </div>
        ))}
      </dl>

      <div className="prose-doc mt-20 grid gap-14 lg:grid-cols-2">
        <section>
          <h2 className="font-serif text-[1.75rem] text-ink">Built by students, for students</h2>
          <p>
            AetherCode began as the exam app for the St. Joseph&apos;s Placements and Training Cell&apos;s HOPE assessments, built by
            AlgoQX, a student venture. It has since grown into a platform any college can run on its own servers, with Safe Exam
            Browser lockdown, sandboxed judging and results staff can trust.
          </p>
          <p>It is built and maintained by {SITE.operatorShort}.</p>
        </section>
        <section>
          <h2 className="font-serif text-[1.75rem] text-ink">Transparent, even though it is not open source</h2>
          <p>
            AetherCode is proprietary software. Colleges use it under a licence, hosted for them or installed on their own servers.
            Assessment software that decides careers shouldn&apos;t be a black box, so how marks are decided and how exams are kept
            honest is documented, and licensed colleges can audit the deployment they run.
          </p>
          <p>
            Read how it works on the <Link href="/architecture">architecture page</Link>, or how it keeps exams honest on the{" "}
            <Link href="/security">security page</Link>.
          </p>
        </section>
      </div>

      <div className="mt-20 flex flex-wrap items-center gap-3">
        {support ? (
          <Button asChild size="lg">
            <a href={`mailto:${support}?subject=AetherCode%20licence`}>Talk to us about a licence</a>
          </Button>
        ) : (
          <p className="text-[15px] text-ink-muted">To license AetherCode, contact the placements and training cell of St. Joseph&apos;s Group of Institutions.</p>
        )}
        <Button asChild size="lg" variant="secondary">
          <Link href="/security">How exams stay honest</Link>
        </Button>
      </div>
    </div>
  );
}
