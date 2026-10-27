"use client";

import { CloudOff, History } from "lucide-react";
import { useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import type { Answers } from "./use-answers";

function subscribe(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/** Online status from the browser; assumed online while rendering on the server. */
function useOnline(): boolean {
  return useSyncExternalStore(subscribe, () => navigator.onLine, () => true);
}

/**
 * Below the exam header: a warning while offline, and an offer to restore code
 * an earlier visit left on this device without the server ever saving it.
 */
export function ConnectionBanner({ answers }: { answers: Answers }) {
  const online = useOnline();
  const recovered = answers.recovered.size;

  return (
    <>
      {!online && (
        <div role="status" className="flex items-center gap-3 border-b border-warning/30 bg-warning-soft px-4 py-2 text-sm text-warning">
          <CloudOff className="size-4 shrink-0" strokeWidth={1.75} />
          <p className="min-w-0 flex-1">
            <span className="font-medium">You&apos;re offline.</span> Keep coding: your code is kept on this device and saves as soon as
            you&apos;re back. The timer keeps running.
          </p>
        </div>
      )}
      {recovered > 0 && (
        <div role="status" className="flex flex-wrap items-center gap-3 border-b bg-brand-soft px-4 py-2 text-sm text-brand-soft-ink">
          <History className="size-4 shrink-0" strokeWidth={1.75} />
          <p className="min-w-0 flex-1">
            Found newer code on this device for {recovered} {recovered === 1 ? "question" : "questions"} that wasn&apos;t saved.
          </p>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => answers.restoreRecovered()}>
              Restore it
            </Button>
            <Button size="sm" variant="ghost" onClick={() => answers.discardRecovered()}>
              Keep saved version
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
