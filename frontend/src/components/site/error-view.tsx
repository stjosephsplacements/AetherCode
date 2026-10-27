"use client";

import { Check, Copy } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * Shared body of the 404 and 500 pages. The incident ID is Next's error digest,
 * which matches the server log line, so staff can find what went wrong.
 */
export function ErrorView({
  code,
  title,
  message,
  incident,
  onRetry,
}: {
  code: string;
  title: string;
  message: string;
  incident?: string;
  onRetry?: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function copyDiagnostics() {
    const lines = [
      `AetherCode ${code}`,
      incident ? `Incident: ${incident}` : null,
      `Page: ${window.location.pathname}`,
      `Time: ${new Date().toISOString()}`,
      `Browser: ${navigator.userAgent}`,
    ].filter(Boolean);
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked (for example in Safe Exam Browser): the ID is on screen to read out.
    }
  }

  return (
    <main className="relative isolate grid min-h-dvh place-items-center overflow-hidden px-6 py-16">
      <div aria-hidden className="pointer-events-none absolute left-1/2 top-[-260px] -z-10 size-[720px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,var(--glow),transparent)]" />
      <div className="w-full max-w-lg animate-enter text-center">
        <p aria-hidden className="font-serif text-[6.5rem] leading-none tracking-tight text-ink/15 sm:text-[8rem]">
          {code}
        </p>
        <h1 className="display -mt-3 text-[2.2rem] text-ink sm:text-[2.6rem]">{title}</h1>
        <p className="mx-auto mt-3 max-w-[42ch] text-[15.5px] leading-relaxed text-ink-muted">{message}</p>
        {incident && (
          <p className="mt-5 text-[13px] text-ink-subtle">
            Incident ID <span className="select-all font-mono text-ink">{incident}</span>
          </p>
        )}
        <div className="mt-8 flex flex-wrap items-center justify-center gap-2">
          {onRetry && <Button onClick={onRetry}>Try again</Button>}
          <Button asChild variant={onRetry ? "secondary" : "primary"}>
            <Link href="/">Go to my dashboard</Link>
          </Button>
          <Button variant="ghost" onClick={() => void copyDiagnostics()}>
            {copied ? <Check /> : <Copy />}
            {copied ? "Copied" : "Copy diagnostic info"}
          </Button>
        </div>
        <p className="mt-10 text-[13px] text-ink-subtle">
          In an exam? Your code is saved. Tell your invigilator, and check the <Link href="/status" className="underline underline-offset-2">status page</Link>.
        </p>
      </div>
    </main>
  );
}
