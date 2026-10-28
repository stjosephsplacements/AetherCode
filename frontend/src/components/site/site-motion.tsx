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
 * - `[data-tilt]` flattens from a tilt as it scrolls up (wide screens only);
 * - `[data-statement]` draws its `[data-strike]` and reveals `[data-answer]`;
 * - `[data-darken]` paragraphs darken word by word with the scroll.
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

          // The statement: the strike draws through, then the answer arrives.
          gsap.utils.toArray<HTMLElement>("[data-statement]").forEach((element) => {
            const timeline = gsap.timeline({ scrollTrigger: { trigger: element, start: "top 78%", end: "top 40%", scrub: 0.6 } });
            timeline
              .fromTo(element.querySelectorAll("[data-strike]"), { scaleX: 0 }, { scaleX: 1, ease: "none" })
              .fromTo(element.querySelectorAll("[data-answer]"), { autoAlpha: 0, y: 12 }, { autoAlpha: 1, y: 0, ease: "power2.out" });
          });

          // Paragraphs that darken word by word as they scroll through.
          gsap.utils.toArray<HTMLElement>("main [data-darken]").forEach((element) => {
            SplitText.create(element, {
              type: "words",
              aria: "auto",
              onSplit: (split) =>
                gsap.fromTo(
                  split.words,
                  { opacity: 0.18 },
                  { opacity: 1, stagger: 0.1, ease: "none", scrollTrigger: { trigger: element, start: "top 80%", end: "bottom 50%", scrub: true } },
                ),
            });
          });

          if (wide) {
            gsap.utils.toArray<HTMLElement>("[data-tilt]").forEach((element) => {
              gsap.fromTo(
                element,
                { rotateX: 18, scale: 0.94, y: 40 },
                { rotateX: 0, scale: 1, y: 0, ease: "none", scrollTrigger: { trigger: element, start: "top 95%", end: "top 25%", scrub: 0.5 } },
              );
            });
          }
        },
      );
      return () => media.revert();
    },
    { dependencies: [pathname], revertOnUpdate: true },
  );

  return null;
}
