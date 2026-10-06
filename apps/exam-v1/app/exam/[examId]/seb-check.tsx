"use client";

import { useEffect, useState } from "react";
import { buttonClass } from "@/components/ui";
import { reportSebCheck, verifySebPage } from "./seb-actions";

interface SebSecurity {
  configKey?: string;
  updateKeys?: (callback: () => void) => void;
}

declare global {
  interface Window {
    SafeExamBrowser?: { security?: SebSecurity };
  }
}

const WAIT_MS = 5000;

/**
 * Verifies SEB through its JavaScript API, whose configKey is SHA256(page URL +
 * Config Key) for this document. SEB may fill the key a moment after load (and
 * SEB for macOS 3.0 only after updateKeys), so wait for it before giving up.
 */
export function SebCheck({ examHref }: { examHref: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let done = false;
    const pageUrl = window.location.href.split("#")[0];
    const fail = (reason: string) => {
      done = true;
      setFailed(true);
      void reportSebCheck(reason, pageUrl);
    };
    const attempt = () => {
      const configKey = window.SafeExamBrowser?.security?.configKey;
      if (done || !configKey) return;
      done = true;
      void verifySebPage(pageUrl, configKey).then((ok) => (ok ? window.location.replace(examHref) : fail("config key mismatch")));
    };
    window.SafeExamBrowser?.security?.updateKeys?.(attempt);
    attempt();
    const poll = setInterval(attempt, 200);
    const timeout = setTimeout(
      () => !done && fail(window.SafeExamBrowser ? "SafeExamBrowser.security.configKey never set" : "no SafeExamBrowser JavaScript API"),
      WAIT_MS,
    );
    return () => {
      done = true;
      clearInterval(poll);
      clearTimeout(timeout);
    };
  }, [examHref]);

  return (
    <main className="grid min-h-dvh place-items-center px-4 text-center">
      {failed ? (
        <div className="max-w-md">
          <h1 className="font-display text-2xl font-semibold">Safe Exam Browser check failed</h1>
          <p className="mt-3 text-sm text-muted">
            This exam must run in the Safe Exam Browser opened from your dashboard. Close SEB, then click “Open in SEB” again. If it keeps
            happening, tell your invigilator.
          </p>
          <div className="mt-6 flex justify-center gap-3">
            <button type="button" onClick={() => window.location.replace(examHref)} className={buttonClass("secondary")}>
              Try again
            </button>
            <a href="/student?seb=1" className={buttonClass("primary")}>
              Back to my exams
            </a>
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted">Checking Safe Exam Browser…</p>
      )}
    </main>
  );
}
