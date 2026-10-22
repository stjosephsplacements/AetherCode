"use client";

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { api } from "@/lib/client/api";

type Kind = "blur" | "paste" | "fullscreen_exit";

function subscribeFullscreen(change: () => void) {
  document.addEventListener("fullscreenchange", change);
  return () => document.removeEventListener("fullscreenchange", change);
}

/** Safe Exam Browser locks the machine itself; its user agent names it. */
function insideSafeExamBrowser(): boolean {
  return typeof navigator !== "undefined" && navigator.userAgent.includes("SEB");
}

/**
 * Exam integrity on the exam screen (ADR-0037), as in the exam app: leaving
 * the window and leaving fullscreen are recorded, and when the exam requires
 * fullscreen the screen is covered until the student returns to it. Inside
 * Safe Exam Browser neither applies; it is already locked down.
 */
export function useIntegrity(attemptPath: string, requireFullscreen: boolean, active: boolean) {
  const activeRef = useRef(active);
  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  const record = useCallback(
    (kind: Kind) => {
      if (!activeRef.current) return;
      void api(`${attemptPath}/events`, { method: "POST", body: { kind } }).catch(() => undefined);
    },
    [attemptPath],
  );

  const fullscreen = useSyncExternalStore(subscribeFullscreen, () => document.fullscreenElement !== null, () => true);
  const seb = useSyncExternalStore(() => () => undefined, insideSafeExamBrowser, () => false);
  const gated = requireFullscreen && !seb && active;

  const wasFullscreen = useRef(fullscreen);
  useEffect(() => {
    if (gated && wasFullscreen.current && !fullscreen) record("fullscreen_exit");
    wasFullscreen.current = fullscreen;
  }, [fullscreen, gated, record]);

  useEffect(() => {
    if (seb) return;
    let last = 0;
    const report = () => {
      if (!activeRef.current || Date.now() - last < 3000) return;
      last = Date.now();
      toast.warning("You left the exam window. This is recorded and visible to your invigilator.");
      record("blur");
    };
    const onVisibility = () => document.visibilityState === "hidden" && report();
    window.addEventListener("blur", report);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("blur", report);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [record, seb]);

  const blockedPaste = useCallback(() => {
    toast.warning("Pasting from outside the exam is disabled. This attempt has been recorded.");
    record("paste");
  }, [record]);

  return {
    needsFullscreen: gated && !fullscreen,
    enterFullscreen: () => void document.documentElement.requestFullscreen().catch(() => undefined),
    blockedPaste,
  };
}
