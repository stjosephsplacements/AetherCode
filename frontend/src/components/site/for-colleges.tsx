import Link from "next/link";

const POINTS = [
  { title: "Your campus, your data", body: "Each college is isolated at the database level. Results and student records stay with the college that owns them." },
  { title: "Runs where you need it", body: "A managed deployment, or a licensed install on your own servers, set up with the team that built it." },
  { title: "Exam-day ready", body: "Safe Exam Browser lockdown, a live monitor for invigilators and staff-assisted recovery for the moments that go wrong." },
];

/** The college pitch: what a deployment gives them and how to get one. */
export function ForColleges() {
  return (
    <section className="text-ink">
      <div className="mx-auto max-w-6xl px-6 py-24 sm:py-28">
        <h2 className="heading max-w-[20ch] text-[2.3rem] sm:text-[3.1rem]">Built for colleges that take exams seriously.</h2>
        <p data-reveal className="mt-6 max-w-[34rem] text-[17px] leading-relaxed text-ink-muted">
          AetherCode is proprietary software from {"St. Joseph\u2019s"} Placements and Training Cell. Colleges use it under a licence, hosted for them or installed on their own servers.
        </p>
        <ul className="mt-12 grid gap-5 sm:grid-cols-3">
          {POINTS.map((point) => (
            <li key={point.title} data-reveal className="rounded-2xl border border-line bg-surface p-6 shadow-[var(--shadow-panel)]">
              <h3 className="text-[17px] font-semibold text-ink">{point.title}</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-ink-muted">{point.body}</p>
            </li>
          ))}
        </ul>
        <div data-reveal className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-3">
          <Link href="/about" className="rounded-full bg-brand px-5 py-2.5 text-[14px] text-brand-ink shadow-[var(--shadow-panel)] transition-transform hover:-translate-x-0.5 hover:-translate-y-0.5">
            Talk to us about a licence
          </Link>
          <Link href="/architecture" className="text-[14px] text-ink-muted transition-colors hover:text-brand">
            How it&apos;s built
          </Link>
        </div>
      </div>
    </section>
  );
}
