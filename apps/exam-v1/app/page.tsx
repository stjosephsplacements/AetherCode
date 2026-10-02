import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser, homeFor } from "@/lib/auth";
import { buttonClass, Logo } from "@/components/ui";

export default async function Home() {
  const user = await currentUser();
  if (user) redirect(homeFor(user.role));
  return (
    <main className="relative isolate min-h-dvh overflow-hidden">
      <div className="hero-glow absolute inset-0 -z-10" />
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-6">
        <Logo />
        <Link href="/login" className={buttonClass("primary", "sm")}>
          Sign in
        </Link>
      </header>
      <section className="mx-auto max-w-6xl px-5 pb-24 pt-[12vh]">
        <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-line bg-surface/70 px-3 py-1 text-xs font-semibold text-muted backdrop-blur">
          <span className="size-1.5 rounded-full bg-accent" /> Campus coding assessments
        </p>
        <h1 className="max-w-4xl font-display text-[clamp(2.6rem,7vw,5.5rem)] font-semibold leading-[0.98] tracking-[-0.035em] text-ink">
          Write code. <span className="text-brand">Get judged</span> fairly.
        </h1>
        <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted">
          Timed programming exams with instant sample-test feedback, hidden-test grading, and results your faculty can export
          the moment the clock stops.
        </p>
        <div className="mt-10 flex flex-wrap gap-3">
          <Link href="/login" className={buttonClass("primary")}>
            Sign in to your exam
          </Link>
        </div>
        <dl className="mt-24 grid max-w-3xl grid-cols-2 gap-8 sm:grid-cols-4">
          {[
            ["4", "languages"],
            ["Run", "against samples"],
            ["Submit", "to hidden tests"],
            ["CSV", "result export"],
          ].map(([value, label]) => (
            <div key={label} className="border-t border-line-strong pt-4">
              <dt className="font-display text-2xl font-semibold tracking-tight text-ink">{value}</dt>
              <dd className="mt-1 text-sm text-muted">{label}</dd>
            </div>
          ))}
        </dl>
      </section>
    </main>
  );
}
