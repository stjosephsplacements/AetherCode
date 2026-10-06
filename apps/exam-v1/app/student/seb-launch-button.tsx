"use client";

import { useCallback, useEffect, useRef, useTransition } from "react";
import { buttonClass } from "@/components/ui";
import { createSebLoginToken } from "./seb-actions";

export function SebLaunchButton({
  examId,
  sebOrigin,
  label = "Open in SEB →",
  autoLaunch = false,
}: {
  examId: string;
  sebOrigin: string;
  label?: string;
  // Launch once on mount (the browser may still ask before opening SEB).
  autoLaunch?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const launch = useCallback(
    () =>
      startTransition(async () => {
        const token = await createSebLoginToken(examId);
        // With startURLAppendQueryParameter, SEB appends the query after "??" to the
        // Start URL. SEB for Windows only splits on "??" (and still sends it with the
        // config download, which ignores it); SEB for macOS strips it from the download.
        window.location.href = `${sebOrigin}/api/exam/${examId}/seb-config??t=${token}`;
      }),
    [examId, sebOrigin],
  );
  const launched = useRef(false);
  useEffect(() => {
    if (!autoLaunch || launched.current) return;
    launched.current = true;
    launch();
  }, [autoLaunch, launch]);
  return (
    <button className={buttonClass("go")} disabled={pending} onClick={launch}>
      {pending ? "Opening…" : label}
    </button>
  );
}
