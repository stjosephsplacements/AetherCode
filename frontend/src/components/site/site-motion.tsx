"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";
import { useLenis } from "lenis/react";
import { usePathname } from "next/navigation";

gsap.registerPlugin(ScrollTrigger, SplitText, useGSAP);

/**
 * Scroll motion for every public page, written against data attributes so
 * pages stay plain markup:
 * - headings (`.heading`, `.display`, `[data-split]`) rise line by line;
 * - `[data-reveal]` blocks fade up in batches the first time they show;
 * - `[data-parallax="n"]` drifts n% against the scroll (wide screens only);
 * - `[data-wordmark]` lifts letter by letter as the footer arrives;
 * - `[data-type]` types its characters out on load (the hero line).
 * Only transform and opacity move, each effect runs once, phones get a
 * lighter set, and reduced motion gets none.
 */
export function SiteMotion() {
  const pathname = usePathname();
  useLenis(ScrollTrigger.update);

  useGSAP(
    () => {
      const media = gsap.matchMedia();
      media.add(
        {
          wide: "(prefers-reduced-motion: no-preference) and (min-width: 768px)",
          narrow: "(prefers-reduced-motion: no-preference) and (max-width: 767px)",
        },
        (context) => {
          const wide = Boolean(context.conditions?.wide);
          const lift = wide ? 48 : 24;

          gsap.utils.toArray<HTMLElement>("main [data-type]").forEach((element) => {
            // Words first, so a line never breaks inside a word.
            SplitText.create(element, {
              type: "words,chars",
              aria: "auto",
              onSplit: (split) =>
                gsap.from(split.chars, { autoAlpha: 0, duration: 0.01, stagger: 0.045, delay: 0.25, ease: "none" }),
            });
          });

          gsap.utils.toArray<HTMLElement>("main .heading, main .display, main [data-split]").forEach((element) => {
            SplitText.create(element, {
              type: "lines",
              mask: "lines",
              autoSplit: true,
              aria: "auto",
              onSplit: (split) =>
                gsap.from(split.lines, {
                  yPercent: 105,
                  duration: 1,
                  stagger: 0.09,
                  ease: "expo.out",
                  scrollTrigger: { trigger: element, start: "top 88%", once: true },
                }),
            });
          });

          const reveals = gsap.utils.toArray<HTMLElement>("main [data-reveal]");
          gsap.set(reveals, { autoAlpha: 0, y: lift });
          ScrollTrigger.batch(reveals, {
            start: "top 90%",
            once: true,
            onEnter: (batch) => gsap.to(batch, { autoAlpha: 1, y: 0, duration: 0.9, stagger: 0.08, ease: "expo.out", overwrite: true }),
          });

          if (wide) {
            gsap.utils.toArray<HTMLElement>("[data-parallax]").forEach((element) => {
              gsap.to(element, {
                yPercent: Number(element.dataset.parallax) || -10,
                ease: "none",
                scrollTrigger: { trigger: element, start: "top bottom", end: "bottom top", scrub: true },
              });
            });
          }

          gsap.utils.toArray<HTMLElement>("[data-wordmark]").forEach((element) => {
            SplitText.create(element, {
              type: "chars",
              aria: "hidden",
              onSplit: (split) =>
                gsap.from(split.chars, {
                  yPercent: 60,
                  autoAlpha: 0,
                  stagger: 0.04,
                  ease: "power3.out",
                  scrollTrigger: { trigger: element, start: "top 98%", end: "bottom bottom", scrub: wide ? 0.6 : false, once: !wide },
                }),
            });
          });
        },
      );
      return () => media.revert();
    },
    { dependencies: [pathname], revertOnUpdate: true },
  );

  return null;
}
