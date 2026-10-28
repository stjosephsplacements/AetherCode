"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useRef } from "react";
import { SITE } from "@/lib/site";

gsap.registerPlugin(ScrollTrigger, useGSAP);

// One submission's live events, as the engine streams them over SSE.
const EVENTS: [string, string, string][] = [
  ["00.000", "QUEUED", "submission received"],
  ["00.041", "COMPILING", "g++ -O2 -std=c++17"],
  ["00.612", "RUNNING", "sandbox: cgroups v2, seccomp, no network"],
  ["00.655", "TEST_RESULT", "test 1  accepted   0.01s  3.1 MB"],
  ["00.690", "TEST_RESULT", "test 2  accepted   0.02s  3.4 MB"],
  ["00.731", "TEST_RESULT", "test 3  accepted   0.04s  5.0 MB"],
  ["00.733", "VERDICT", "accepted  3/3"],
];

const GUARANTEES = [
  "Linux cgroups v2: CPU, memory and PID limits",
  "seccomp-bpf syscall filters",
  "no network: isolated network namespaces",
  "read-only root filesystem, wall-clock watchdog",
];

// From the engine's published load test (docs/benchmark-results.md).
const LOAD = [
  ["5,000", "concurrent clients"],
  ["15,000", "submissions"],
  ["121", "jobs per second"],
  ["0", "jobs lost"],
];

/**
 * The AetherCode Execution Engine, the open-source sandbox that runs every
 * submission (ADR-0028): what isolates the code, one run streamed event by
 * event (played once when it scrolls in), and the published load test.
 */
export function Engine() {
  const root = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const media = gsap.matchMedia();
      media.add("(prefers-reduced-motion: no-preference)", () => {
        gsap.from("[data-event]", {
          autoAlpha: 0,
          x: -8,
          duration: 0.25,
          stagger: 0.32,
          ease: "power2.out",
          scrollTrigger: { trigger: root.current, start: "top 65%", once: true },
        });
      });
      return () => media.revert();
    },
    { scope: root },
  );

  return (
    <section id="engine" ref={root} className="mx-auto max-w-6xl scroll-mt-20 px-6 py-24">
      <h2 className="heading text-[2.3rem] text-ink sm:text-[3.1rem]">The engine that runs your code</h2>
      <p data-reveal className="mt-4 max-w-[44rem] text-[16px] leading-relaxed text-ink-muted">
        Every Run and Submit goes to the AetherCode Execution Engine: an open-source Go service that compiles and runs untrusted
        code inside Linux kernel sandboxes and streams each step back as it happens.
      </p>

      <div className="mt-12 border border-ink bg-surface shadow-[6px_6px_0_var(--ink)]">
        <div className="flex border-b border-ink font-mono text-[13px]">
          <p className="px-4 py-2.5 text-ink">[ aethercode-execution-engine ]</p>
          <p className="ml-auto hidden px-4 py-2.5 text-ink-subtle sm:block">Go · AGPL-3.0</p>
        </div>

        <div className="grid lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
          <div className="flex flex-col p-6 sm:p-10">
            <h3 className="heading text-[1.7rem] leading-[1.15] text-ink">Untrusted code, contained</h3>
            <ul className="mt-6 space-y-3 font-mono text-[13px] text-ink">
              {GUARANTEES.map((item) => (
                <li key={item} className="flex gap-3">
                  <span className="text-success">[x]</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
            <a
              href={SITE.engineRepo}
              className="mt-10 w-fit border border-ink px-4 py-2.5 font-mono text-[13.5px] text-ink shadow-[3px_3px_0_var(--ink)] transition-colors hover:border-brand hover:bg-brand hover:text-brand-ink"
            >
              [ view the engine on github -&gt; ]
            </a>
          </div>

          <div className="border-t border-ink bg-canvas p-6 text-ink sm:p-10 lg:border-l lg:border-t-0">
            <p className="font-mono text-[12.5px] text-ink-subtle">GET /api/v1/stream  (server-sent events)</p>
            <ol aria-label="Events for one submission" className="mt-5 space-y-2 font-mono text-[12.5px] sm:text-[13px]">
              {EVENTS.map(([time, event, detail], index) => (
                <li key={index} data-event className="grid grid-cols-[4.5rem_7.5rem_1fr] gap-2">
                  <span className="text-ink-subtle">{time}</span>
                  <span className={event === "VERDICT" ? "text-success" : "text-accent"}>{event}</span>
                  <span className="truncate">{detail}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-px border-t border-ink bg-ink font-mono sm:grid-cols-4">
          {LOAD.map(([value, label]) => (
            <div key={label} className="flex flex-col-reverse bg-surface px-6 py-5">
              <dt className="mt-1 text-[12px] text-ink-muted">{label}</dt>
              <dd className="text-[1.6rem] text-ink">{value}</dd>
            </div>
          ))}
        </dl>
        <p className="border-t border-ink px-6 py-3 font-mono text-[11.5px] text-ink-subtle">
          {"// published load test on a 256-thread host, 64 sandbox workers. your numbers depend on your hardware."}
        </p>
      </div>
    </section>
  );
}
