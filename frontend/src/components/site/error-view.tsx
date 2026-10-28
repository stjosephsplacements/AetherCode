"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { ERROR_ART } from "./error-art";

/**
 * Shared body of the 404 and 500 pages, in the site's ASCII style: the code in
 * figlet type, the failed request as a terminal line, and plain next steps.
 * The incident ID is Next's error digest, which matches the server log line,
 * so staff can find what went wrong.
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
  const pathname = usePathname();
  const [copied, setCopied] = useState(false);
  const face = code === "404" ? "(o_o)?" : "(x_x)";
  const verdict = code === "404" ? "404 not found" : `${code} something broke`;

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
    <main className="ascii grid min-h-dvh place-items-center bg-canvas px-6 py-16">
      <div className="w-full max-w-xl animate-enter">
        <pre aria-hidden className="text-[clamp(14px,3.6vw,22px)] leading-[1.1] text-brand">
          {ERROR_ART[code] ?? code}
        </pre>

        <h1 className="heading mt-8 text-[2.2rem] leading-[1.1] text-ink sm:text-[2.8rem]">
          {title} <span className="whitespace-nowrap font-mono text-[0.6em] text-ink-subtle">{face}</span>
        </h1>
        <p className="mt-4 max-w-[46ch] text-[15.5px] leading-relaxed text-ink-muted">{message}</p>

        <div className="mt-8 border border-ink bg-surface font-mono text-[13px] shadow-[4px_4px_0_var(--ink)]">
          <p className="border-b border-ink px-4 py-2 text-ink-subtle">[ request ]</p>
          <div className="space-y-1 px-4 py-3">
            <p className="break-all text-ink">
              <span className="text-brand">$ </span>GET {pathname || "/"}
            </p>
            <p className="text-danger">[x] {verdict}</p>
            {incident && (
              <p className="text-ink-muted">
                incident <span className="select-all text-ink">{incident}</span>
              </p>
            )}
          </div>
        </div>

        <div className="mt-8 flex flex-wrap items-center gap-3 font-mono text-[14px]">
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="bg-brand px-4 py-2.5 text-brand-ink shadow-[3px_3px_0_var(--ink)] transition-transform hover:-translate-x-0.5 hover:-translate-y-0.5"
            >
              [ try again ]
            </button>
          )}
          <Link
            href="/"
            className={
              onRetry
                ? "border border-ink px-4 py-2.5 text-ink shadow-[3px_3px_0_var(--ink)] transition-transform hover:-translate-x-0.5 hover:-translate-y-0.5"
                : "bg-brand px-4 py-2.5 text-brand-ink shadow-[3px_3px_0_var(--ink)] transition-transform hover:-translate-x-0.5 hover:-translate-y-0.5"
            }
          >
            [ go to my dashboard ]
          </Link>
          <button type="button" onClick={() => void copyDiagnostics()} className="px-2 py-2.5 text-ink-muted transition-colors hover:text-ink">
            {copied ? "[copied \\o/]" : "[copy diagnostic info]"}
          </button>
        </div>

        <p className="mt-10 font-mono text-[12.5px] leading-relaxed text-ink-subtle">
          {"// in an exam? your code is saved. tell your invigilator, and check the "}
          <Link href="/status" className="text-ink underline underline-offset-2">
            status page
          </Link>
          .
        </p>
      </div>
    </main>
  );
}
