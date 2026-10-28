"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { Fragment, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { SCREENS } from "./meet-screens";

const TABS = [
  { key: "lockdown", label: "lockdown", title: "Locked when it counts", body: "Staff choose what each exam needs: Safe Exam Browser, lab networks only, fullscreen. Every request is checked against it." },
  { key: "exam", label: "exam screen", title: "Code like it's your IDE", body: "Six languages. Run code on the samples or your own input as often as you like, and your work saves as you type." },
  { key: "monitor", label: "live monitor", title: "Watch it happen", body: "Every student's status, questions done and time left. Add time for one student, or announce to every screen." },
  { key: "results", label: "results", title: "Marks you can explain", body: "Hidden until faculty release them. Then each question's score and every test's verdict, never the hidden inputs." },
] as const;

/** Colours the verdict tokens inside a drawn screen line. */
function Line({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\[ok\]|\[x\])/).map((part, index) =>
        part === "[ok]" ? (
          <span key={index} className="text-success">{part}</span>
        ) : part === "[x]" ? (
          <span key={index} className="text-danger">{part}</span>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        ),
      )}
    </>
  );
}

gsap.registerPlugin(ScrollTrigger, useGSAP);

/**
 * One terminal-style window with a tab per part of exam day; each tab draws
 * its screen in text. On wide screens the window pins and scrolling steps
 * through the tabs, filling a bar under the active one (HackerRank's pinned
 * story); clicking a tab jumps the scroll there. Phones and reduced motion
 * keep plain tabs.
 */
export function Meet() {
  const [active, setActive] = useState(0);
  const tab = TABS[active]!;
  const pinRef = useRef<HTMLDivElement>(null);
  const bars = useRef<(HTMLSpanElement | null)[]>([]);
  const story = useRef<ScrollTrigger | null>(null);

  useGSAP(
    () => {
      const media = gsap.matchMedia();
      media.add("(prefers-reduced-motion: no-preference) and (min-width: 1024px)", () => {
        story.current = ScrollTrigger.create({
          trigger: pinRef.current,
          start: "top 72px",
          end: () => `+=${window.innerHeight * 0.7 * TABS.length}`,
          pin: true,
          onUpdate: (self) => {
            const position = Math.min(self.progress * TABS.length, TABS.length - 0.0001);
            const index = Math.floor(position);
            setActive((current) => (current === index ? current : index));
            bars.current.forEach((bar, barIndex) => {
              if (bar) bar.style.transform = `scaleX(${barIndex < index ? 1 : barIndex === index ? position - index : 0})`;
            });
          },
        });
        return () => {
          story.current = null;
        };
      });
      return () => media.revert();
    },
    { scope: pinRef },
  );

  // When the story is pinned, a click scrolls to that tab's stretch instead of fighting the scroll.
  const choose = (index: number) => {
    const trigger = story.current;
    if (trigger) window.scrollTo({ top: trigger.start + ((index + 0.5) / TABS.length) * (trigger.end - trigger.start) });
    setActive(index);
  };

  return (
    <section id="product" className="mx-auto max-w-6xl scroll-mt-20 px-6 py-24">
      <div className="text-center">
        <h2 className="heading text-[2.6rem] text-ink sm:text-[3.6rem]">
          Meet <span className="marker">AetherCode</span>
        </h2>
        <p data-reveal className="mt-3 text-[15px] text-ink-subtle">
          {"// everything between the question and the result"}
        </p>
      </div>

      <div ref={pinRef} className="pt-12">
      <div className="border border-ink bg-surface shadow-[6px_6px_0_var(--ink)]">
        <div role="tablist" aria-label="Parts of an exam day" className="flex flex-wrap border-b border-ink text-[13.5px]">
          {TABS.map((item, index) => (
            <button
              key={item.key}
              role="tab"
              type="button"
              id={`meet-tab-${item.key}`}
              aria-selected={active === index}
              aria-controls="meet-panel"
              onClick={() => choose(index)}
              onKeyDown={(event) => {
                if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
                const next = (index + (event.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length;
                choose(next);
                document.getElementById(`meet-tab-${TABS[next]!.key}`)?.focus();
              }}
              tabIndex={active === index ? 0 : -1}
              className={cn(
                "relative border-r border-ink px-4 py-2.5 transition-colors",
                active === index ? "bg-brand text-brand-ink" : "text-ink-muted hover:bg-hover hover:text-ink",
              )}
            >
              [{index + 1}] {item.label}
              <span
                ref={(bar) => {
                  bars.current[index] = bar;
                }}
                aria-hidden
                className="absolute inset-x-0 bottom-0 h-[3px] origin-left scale-x-0 bg-ink"
              />
            </button>
          ))}
        </div>

        <div id="meet-panel" role="tabpanel" aria-labelledby={`meet-tab-${tab.key}`} className="grid gap-10 p-6 sm:p-10 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:items-center">
          <div key={tab.key} className="animate-enter">
            <p className="text-[12.5px] text-ink-subtle">
              {active + 1} / {TABS.length}
            </p>
            <h3 className="heading mt-3 text-[1.9rem] leading-[1.15] text-ink sm:text-[2.3rem]">{tab.title}</h3>
            <p className="mt-4 max-w-[30rem] text-[14.5px] leading-relaxed text-ink-muted">{tab.body}</p>
          </div>
          <pre key={`${tab.key}-screen`} aria-hidden className="animate-enter overflow-x-auto text-[clamp(10px,1.25vw,13.5px)] leading-[1.6] text-ink">
            {SCREENS[tab.key].map((text, index) => (
              <span key={index} className="block">
                <Line text={text} />
                {"​"}
              </span>
            ))}
          </pre>
        </div>
      </div>
      </div>
    </section>
  );
}
