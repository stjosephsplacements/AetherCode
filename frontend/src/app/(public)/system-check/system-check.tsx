"use client";

import { Check, LoaderCircle, RotateCw, TriangleAlert, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Result = { state: "running" | "pass" | "warn" | "fail"; value: string; advice?: string };
type CheckId = "browser" | "storage" | "screen" | "seb" | "latency" | "platform" | "download" | "fullscreen";

const CHECKS: { id: CheckId; title: string }[] = [
  { id: "browser", title: "Browser" },
  { id: "storage", title: "Cookies and storage" },
  { id: "screen", title: "Screen size" },
  { id: "seb", title: "Safe Exam Browser" },
  { id: "latency", title: "Connection to AetherCode" },
  { id: "platform", title: "Exam services" },
  { id: "download", title: "Download speed" },
  { id: "fullscreen", title: "Fullscreen" },
];

const PING = "/system-check/ping";

const RUNNING: Partial<Record<CheckId, Result>> = Object.fromEntries(CHECKS.map((check) => [check.id, { state: "running", value: "Checking" }]));

function browserName(ua: string): string {
  if (/SEB\//.test(ua)) return "Safe Exam Browser";
  if (/Edg\//.test(ua)) return "Edge";
  if (/Firefox\//.test(ua)) return "Firefox";
  if (/Chrome\//.test(ua)) return "Chrome";
  if (/Safari\//.test(ua)) return "Safari";
  return "Your browser";
}

async function median(times: number, run: () => Promise<number>): Promise<number> {
  const samples: number[] = [];
  for (let i = 0; i < times; i++) samples.push(await run());
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)] ?? 0;
}

async function runCheck(id: CheckId): Promise<Result> {
  switch (id) {
    case "browser": {
      // Features the exam screen and editor rely on.
      const modern = typeof structuredClone === "function" && typeof crypto.randomUUID === "function" && CSS.supports("selector(:has(*))");
      const name = browserName(navigator.userAgent);
      return modern
        ? { state: "pass", value: `${name} is up to date` }
        : { state: "fail", value: `${name} is too old`, advice: "Update to the latest Chrome, Edge, Firefox or Safari." };
    }
    case "storage": {
      let local = false;
      try {
        localStorage.setItem("aether-check", "1");
        localStorage.removeItem("aether-check");
        local = true;
      } catch {
        local = false;
      }
      if (!navigator.cookieEnabled) return { state: "fail", value: "Cookies are blocked", advice: "Allow cookies for this site, or you can't stay signed in." };
      if (!local || typeof indexedDB === "undefined")
        return { state: "warn", value: "Storage is blocked", advice: "Your code can't be kept on this device if the connection drops. Avoid private windows." };
      return { state: "pass", value: "Allowed" };
    }
    case "screen": {
      const width = window.screen.width;
      return width >= 1280
        ? { state: "pass", value: `${width} px wide` }
        : { state: "warn", value: `${width} px wide`, advice: "A laptop or desktop screen (1280 px or wider) makes the editor much easier to use." };
    }
    case "seb":
      return /SEB\//.test(navigator.userAgent)
        ? { state: "pass", value: "Detected" }
        : { state: "warn", value: "Not in use", advice: "Only needed if your exam says so. Install the version your college gives you." };
    case "latency": {
      try {
        const ms = await median(5, async () => {
          const started = performance.now();
          await fetch(`${PING}?kind=latency&t=${Math.random()}`, { cache: "no-store" });
          return performance.now() - started;
        });
        const rounded = Math.round(ms);
        if (rounded <= 150) return { state: "pass", value: `${rounded} ms` };
        if (rounded <= 400) return { state: "warn", value: `${rounded} ms`, advice: "Usable, but Run and Submit will feel slow. Move closer to the Wi-Fi or use a cable." };
        return { state: "fail", value: `${rounded} ms`, advice: "Your connection is very slow. Try another network before the exam." };
      } catch {
        return { state: "fail", value: "Can't reach AetherCode", advice: "Check you're online and that your network doesn't block this site." };
      }
    }
    case "platform": {
      try {
        const response = await fetch(`${PING}?kind=platform`, { cache: "no-store" });
        const body = (await response.json()) as { ok: boolean; ms: number };
        return body.ok
          ? { state: "pass", value: "Ready" }
          : { state: "fail", value: "Not ready", advice: "This isn't your computer: the exam servers are having trouble. Check the status page." };
      } catch {
        return { state: "fail", value: "Unknown", advice: "Couldn't ask the servers. Try again in a minute." };
      }
    }
    case "download": {
      try {
        const started = performance.now();
        const response = await fetch(`${PING}?kind=download&t=${Math.random()}`, { cache: "no-store" });
        const bytes = (await response.arrayBuffer()).byteLength;
        const mbps = (bytes * 8) / ((performance.now() - started) / 1000) / 1_000_000;
        const value = `${mbps >= 10 ? Math.round(mbps) : mbps.toFixed(1)} Mbps`;
        if (mbps >= 2) return { state: "pass", value };
        return { state: "warn", value, advice: "The editor may take a while to load. Open the exam a few minutes early." };
      } catch {
        return { state: "fail", value: "Failed", advice: "The download was interrupted. Check your connection." };
      }
    }
    case "fullscreen":
      return document.fullscreenEnabled
        ? { state: "pass", value: "Supported" }
        : { state: "warn", value: "Not available", advice: "Some exams ask you to stay in fullscreen. Use a different browser if your exam needs it." };
  }
}

const ICONS = {
  running: <LoaderCircle className="size-4 animate-spin text-ink-subtle" />,
  pass: <Check className="size-4 text-success" strokeWidth={2.5} />,
  warn: <TriangleAlert className="size-4 text-warning" />,
  fail: <X className="size-4 text-danger" strokeWidth={2.5} />,
};

export function SystemCheck() {
  const [results, setResults] = useState<Partial<Record<CheckId, Result>>>(RUNNING);
  const [fullscreenTried, setFullscreenTried] = useState<"ok" | "failed" | null>(null);

  const [round, setRound] = useState(0);

  // Network checks run one after another so they don't skew each other.
  useEffect(() => {
    let cancelled = false;
    CHECKS.reduce(
      (previous, check) =>
        previous.then(() =>
          runCheck(check.id).then((result) => {
            if (!cancelled) setResults((current) => ({ ...current, [check.id]: result }));
          }),
        ),
      Promise.resolve(),
    );
    return () => {
      cancelled = true;
    };
  }, [round]);

  const rerun = () => {
    setResults(RUNNING);
    setRound((current) => current + 1);
  };

  async function tryFullscreen() {
    try {
      await document.documentElement.requestFullscreen();
      await document.exitFullscreen();
      setFullscreenTried("ok");
    } catch {
      setFullscreenTried("failed");
    }
  }

  const done = CHECKS.every((check) => results[check.id] && results[check.id]?.state !== "running");
  const failures = CHECKS.filter((check) => results[check.id]?.state === "fail").length;
  const warnings = CHECKS.filter((check) => results[check.id]?.state === "warn").length;

  return (
    <div>
      <div aria-live="polite" className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-[17px] font-medium text-ink">
          {!done
            ? "Checking your setup…"
            : failures > 0
              ? `${failures} ${failures === 1 ? "problem" : "problems"} to fix before your exam`
              : warnings > 0
                ? "You're good to go, with a few things to note"
                : "You're ready for your exam"}
        </p>
        <Button variant="secondary" size="sm" onClick={rerun} disabled={!done}>
          <RotateCw />
          Check again
        </Button>
      </div>

      <ul className="mt-6 divide-y divide-line overflow-hidden rounded-[var(--radius-surface)] border border-line bg-surface">
        {CHECKS.map((check) => {
          const result = results[check.id];
          return (
            <li key={check.id} className="px-5 py-4">
              <div className="flex items-center gap-3">
                <span className="grid size-7 shrink-0 place-items-center rounded-full bg-surface-2">{result ? ICONS[result.state] : ICONS.running}</span>
                <span className="flex-1 text-[15px] text-ink">{check.title}</span>
                <span className={cn("font-mono text-[13px]", result?.state === "fail" ? "text-danger" : "text-ink-muted")}>{result?.value ?? "Waiting"}</span>
              </div>
              {result?.advice && <p className="mt-2 pl-10 text-[13.5px] leading-relaxed text-ink-muted">{result.advice}</p>}
              {check.id === "fullscreen" && result?.state === "pass" && (
                <div className="mt-2 flex items-center gap-3 pl-10">
                  <Button variant="ghost" size="sm" onClick={() => void tryFullscreen()}>
                    Try fullscreen
                  </Button>
                  {fullscreenTried && (
                    <span className={cn("text-[13px]", fullscreenTried === "ok" ? "text-success" : "text-danger")}>
                      {fullscreenTried === "ok" ? "Worked" : "Your browser refused. Check its settings."}
                    </span>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
