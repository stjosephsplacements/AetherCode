"use client";

import { Check, Clock3, LockKeyhole, WifiOff, X } from "lucide-react";
import { motion, useReducedMotion, useScroll, useTransform } from "motion/react";
import { useRef } from "react";
import { cn } from "@/lib/utils";

// One exam day, hour by hour. Every frame is something the platform really does.
const FRAMES = [
  {
    time: "09:40",
    title: "Run the system check.",
    body: "Browser, storage, screen, connection. A minute the night before saves the panic in the morning.",
    art: <Checklist rows={["Browser", "Cookies and storage", "Screen size", "Connection to AetherCode"]} />,
  },
  {
    time: "10:00",
    title: "Press Start. The clock is yours.",
    body: "Your timer starts when you do, and extra time set for you is already counted in.",
    art: (
      <div className="flex flex-col items-start gap-3">
        <span className="font-mono text-[3.4rem] leading-none tracking-tight text-ink">60:00</span>
        <Chip tone="success" icon={<LockKeyhole className="size-3.5" />}>Safe Exam Browser verified</Chip>
      </div>
    ),
  },
  {
    time: "10:12",
    title: "Run it. Again. And again.",
    body: "Sample tests as often as you like, in the language you think in. Runs never cost you marks.",
    art: <Verdicts rows={[["Sample 1", true], ["Sample 2", false], ["Sample 2", true]]} />,
  },
  {
    time: "10:31",
    title: "The Wi-Fi dies. Breathe.",
    body: "Your code is saved on this laptop first and synced the moment the connection is back.",
    art: (
      <div className="flex flex-col items-start gap-3">
        <Chip tone="muted" icon={<WifiOff className="size-3.5" />}>Offline, saving on this laptop</Chip>
        <Chip tone="success" icon={<Check className="size-3.5" strokeWidth={3} />}>Back online, all changes synced</Chip>
      </div>
    ),
  },
  {
    time: "10:58",
    title: "Accepted.",
    body: "Hidden tests decide your marks, and each question keeps your best submission.",
    art: (
      <div>
        <p className="font-serif text-[3.4rem] leading-none text-success">Accepted</p>
        <p className="mt-3 text-[15px] text-ink-muted">12 of 12 hidden tests, 20 of 20 marks</p>
      </div>
    ),
  },
  {
    time: "11:00",
    title: "Time's up. Hands off.",
    body: "Whatever you saved goes in by itself. No last-second clicking, no lost answers.",
    art: (
      <div className="flex flex-col items-start gap-3">
        <span className="font-mono text-[3.4rem] leading-none tracking-tight text-danger">00:00</span>
        <Chip tone="muted" icon={<Clock3 className="size-3.5" />}>Your saved code is being evaluated</Chip>
      </div>
    ),
  },
  {
    time: "17:00",
    title: "Results are out.",
    body: "When staff release them you see every test case, what passed, what failed and why.",
    art: <Verdicts rows={[["Small input", true], ["Duplicates", true], ["n = 100000", false]]} />,
  },
];

/**
 * The day, sideways: the section pins and the frames slide past as you
 * scroll, while the sky behind turns from dawn to dusk and a sun crosses it.
 * Its edges fade into the page so the sky rises out of it and sinks back.
 * Reduced motion lays the frames out as a plain vertical list.
 */
export function ExamDay() {
  const ref = useRef<HTMLElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end end"] });

  // Each hour is one slot wide (set in CSS), so the next and previous hours peek in at the sides.
  const x = useTransform(scrollYProgress, (value) => `calc(var(--slot) * ${-value * (FRAMES.length - 1)})`);
  const dot = useTransform(scrollYProgress, [0, 1], ["0%", "100%"]);
  const sky = useTransform(
    scrollYProgress,
    [0, 0.35, 0.65, 1],
    [
      "linear-gradient(180deg, #2a2a6e 0%, #8a6fd1 55%, #ffb38a 100%)",
      "linear-gradient(180deg, #2f62c8 0%, #6fa8ff 55%, #cfe3ff 100%)",
      "linear-gradient(180deg, #3b3f9e 0%, #d9895b 60%, #ffcf7a 100%)",
      "linear-gradient(180deg, #0f0b1e 0%, #4a1f55 50%, #ff7a45 100%)",
    ],
  );
  const sunX = useTransform(scrollYProgress, [0, 1], ["6vw", "86vw"]);
  const sunY = useTransform(scrollYProgress, [0, 0.5, 1], ["86vh", "52vh", "86vh"]);

  if (reduce) {
    return (
      <section aria-labelledby="exam-day" className="mx-auto max-w-3xl px-6 py-28">
        <Heading />
        <ol className="mt-12 space-y-6">
          {FRAMES.map((frame) => (
            <li key={frame.time}>
              <Frame frame={frame} />
            </li>
          ))}
        </ol>
      </section>
    );
  }

  return (
    <section
      ref={ref}
      aria-labelledby="exam-day"
      className="relative [mask-image:linear-gradient(to_bottom,transparent,black_24vh,black_calc(100%-26vh),transparent)]"
      style={{ height: `${FRAMES.length * 85}vh` }}
    >
      <motion.div style={{ backgroundImage: sky }} className="grain sticky top-0 flex h-dvh flex-col overflow-hidden">
        <motion.div
          aria-hidden
          style={{ x: sunX, y: sunY }}
          className="absolute left-0 top-0 size-28 rounded-full bg-[radial-gradient(circle,#fff6d6_0%,#ffd27a_45%,rgb(255_160_80/0)_70%)] blur-[1px] sm:size-40"
        />
        <div className="relative z-[2] mx-auto w-full max-w-6xl px-6 pt-24 sm:pt-28">
          <Heading light />
        </div>
        <motion.ol style={{ x }} className="relative z-[2] flex flex-1 items-center pl-[calc((100vw-var(--slot))/2)] [--slot:88vw] md:[--slot:66vw] lg:[--slot:58vw]">
          {FRAMES.map((frame) => (
            <li key={frame.time} className="relative flex w-[var(--slot)] shrink-0 flex-col items-center justify-center px-3 sm:px-5">
              <span aria-hidden className="pointer-events-none absolute -top-[0.42em] left-1/2 -translate-x-1/2 select-none font-mono text-[22vw] font-semibold leading-none tracking-tighter text-white/[0.13] lg:text-[13vw]">
                {frame.time}
              </span>
              <Frame frame={frame} />
            </li>
          ))}
        </motion.ol>
        <div aria-hidden className="relative z-[2] mx-auto mb-10 w-[calc(100%-2rem)] max-w-4xl rounded-full bg-[#0f0b1e]/35 px-6 pb-2.5 pt-4 backdrop-blur-md sm:mb-14 sm:px-8">
          <div className="relative h-px bg-white/35">
            <motion.span style={{ left: dot }} className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_0_16px_4px_rgb(255_255_255/0.6)]" />
          </div>
          <div className="mt-3 flex justify-between font-mono text-[11.5px] text-white sm:text-[12.5px]">
            {FRAMES.map((frame) => (
              <span key={frame.time}>{frame.time}</span>
            ))}
          </div>
        </div>
      </motion.div>
    </section>
  );
}

function Heading({ light = false }: { light?: boolean }) {
  return (
    <h2 id="exam-day" className={cn("display text-[2.4rem] sm:text-[3.6rem]", light ? "text-white [text-shadow:0_4px_30px_rgb(15_11_30/0.45)]" : "text-ink")}>
      Exam day, hour by hour.
    </h2>
  );
}

function Frame({ frame }: { frame: (typeof FRAMES)[number] }) {
  return (
    <article className="grid w-full max-w-[880px] gap-8 rounded-[28px] border border-line bg-surface/90 p-7 shadow-[var(--shadow-overlay)] backdrop-blur-xl sm:p-10 md:grid-cols-[1fr_1fr] md:items-center">
      <div>
        <p className="font-mono text-[15px] text-accent">{frame.time}</p>
        <h3 className="mt-3 font-serif text-[2rem] leading-[1.1] tracking-tight text-ink sm:text-[2.5rem]">{frame.title}</h3>
        <p className="mt-4 text-[15.5px] leading-relaxed text-ink-muted">{frame.body}</p>
      </div>
      <div aria-hidden className="rounded-[20px] bg-surface-2 p-6 sm:p-8">
        {frame.art}
      </div>
    </article>
  );
}

function Chip({ tone, icon, children }: { tone: "success" | "muted"; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[14px]", tone === "success" ? "bg-success-soft text-success" : "bg-surface text-ink-muted")}>
      {icon}
      {children}
    </span>
  );
}

function Checklist({ rows }: { rows: string[] }) {
  return (
    <ul className="space-y-2.5 text-[15px]">
      {rows.map((row) => (
        <li key={row} className="flex items-center gap-3 text-ink">
          <span className="grid size-5 place-items-center rounded-full bg-success-soft text-success">
            <Check className="size-3" strokeWidth={3} />
          </span>
          {row}
        </li>
      ))}
    </ul>
  );
}

function Verdicts({ rows }: { rows: [string, boolean][] }) {
  return (
    <ul className="space-y-2.5 font-mono text-[14px]">
      {rows.map(([name, ok], index) => (
        <li key={`${name}-${index}`} className="flex items-center gap-3">
          <span className={cn("grid size-5 place-items-center rounded-full", ok ? "bg-success-soft text-success" : "bg-danger-soft text-danger")}>
            {ok ? <Check className="size-3" strokeWidth={3} /> : <X className="size-3" strokeWidth={3} />}
          </span>
          <span className="text-ink">{name}</span>
          <span className={cn("ml-auto", ok ? "text-success" : "text-danger")}>{ok ? "passed" : "failed"}</span>
        </li>
      ))}
    </ul>
  );
}
