/**
 * The fairness line, HackerRank-style: as it scrolls in, a strike draws through
 * "depend on your college" and the answer appears, while the paragraph beside
 * it darkens word by word. The motion lives in SiteMotion; without it (or with
 * reduced motion) the finished state shows.
 */
export function Statement() {
  return (
    <section className="mx-auto grid max-w-6xl gap-10 px-6 py-24 sm:py-28 lg:grid-cols-2 lg:gap-16">
      <h2 data-statement className="font-serif text-[2.4rem] leading-[1.12] tracking-[-0.02em] text-ink sm:text-[3.2rem]">
        Placements{" "}
        <span className="relative whitespace-nowrap text-ink-subtle">
          depend on your college
          <span data-strike aria-hidden className="absolute inset-x-0 top-[55%] h-[3px] origin-left bg-brand" />
        </span>{" "}
        <span data-answer>depend on your code.</span>
      </h2>
      <p data-darken className="font-serif text-[1.35rem] leading-[1.5] text-ink sm:text-[1.6rem]">
        Every student sits the same exam, in the same editor, judged by the same hidden tests. Marks come from what you write,
        not where you studied.
      </p>
    </section>
  );
}
