import { SITE } from "@/lib/site";

const STATS = [
  { value: SITE.stats.students, label: "students have taken exams here" },
  { value: SITE.stats.runs, label: "code runs judged" },
  { value: String(SITE.languages.length), label: "languages, compiled and sandboxed" },
];

/** A quiet row of real numbers under the hero. */
export function Numbers() {
  return (
    <section aria-label="AetherCode in numbers" className="border-y border-line">
      <dl className="mx-auto grid max-w-6xl divide-line sm:grid-cols-3 sm:divide-x">
        {STATS.map((stat) => (
          <div key={stat.label} data-reveal className="flex flex-col-reverse px-6 py-10">
            <dt className="mt-1 text-[14px] text-ink-muted">{stat.label}</dt>
            <dd className="text-[2.6rem] font-bold leading-none tracking-[-0.04em] text-ink">{stat.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
