import type { Metadata } from "next";
import { gatewayURL } from "@/lib/server/config";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Status",
  description: "Live health of AetherCode: the web app and the services behind exams, grading and sign-in.",
  alternates: { canonical: "/status" },
};

// Always live: a cached "operational" would be worse than none.
export const dynamic = "force-dynamic";

type Check = { name: string; detail: string; ok: boolean; ms: number | null };

/** The gateway's own readiness probes every service behind it (identity, judge, grading...). */
async function platformCheck(): Promise<Check> {
  const started = performance.now();
  try {
    const response = await fetch(`${gatewayURL()}/readyz`, { cache: "no-store", signal: AbortSignal.timeout(4000) });
    return {
      name: "Exams, grading and sign-in",
      detail: "The gateway and every service behind it: sign-in, exams, code execution and results.",
      ok: response.ok,
      ms: Math.round(performance.now() - started),
    };
  } catch {
    return { name: "Exams, grading and sign-in", detail: "The gateway did not answer within 4 seconds.", ok: false, ms: null };
  }
}

const timeFormat = new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: process.env.NEXT_PUBLIC_TIME_ZONE || "Asia/Kolkata", timeZoneName: "short" });

export default async function StatusPage() {
  const platform = await platformCheck();
  // This page rendering is itself the web app's check.
  const checks: Check[] = [{ name: "Website", detail: "Pages, sign-in screen and the code editor.", ok: true, ms: null }, platform];
  const healthy = checks.every((check) => check.ok);

  return (
    <div className="mx-auto max-w-3xl px-6 pb-24 pt-14 sm:pt-20">
      <h1 className="display text-[2.6rem] text-ink sm:text-[3.4rem]">Status</h1>

      <div
        role="status"
        className={cn(
          "mt-10 flex items-center gap-4 rounded-[var(--radius-surface)] border px-6 py-5",
          healthy ? "border-success/30 bg-success-soft" : "border-danger/30 bg-danger-soft",
        )}
      >
        <span aria-hidden className="relative flex size-3">
          <span className={cn("absolute inline-flex size-full animate-ping rounded-full opacity-50", healthy ? "bg-success" : "bg-danger")} />
          <span className={cn("relative inline-flex size-3 rounded-full", healthy ? "bg-success" : "bg-danger")} />
        </span>
        <div>
          <p className={cn("text-[17px] font-semibold", healthy ? "text-success" : "text-danger")}>
            {healthy ? "Everything is working" : "Some things aren't working"}
          </p>
          <p className="mt-0.5 text-[13px] text-ink-muted">Checked at {timeFormat.format(new Date())}. Refresh to check again.</p>
        </div>
      </div>

      <ul className="mt-6 divide-y divide-line overflow-hidden rounded-[var(--radius-surface)] border border-line bg-surface">
        {checks.map((check) => (
          <li key={check.name} className="flex items-start justify-between gap-6 px-6 py-5">
            <div>
              <p className="text-[15px] font-medium text-ink">{check.name}</p>
              <p className="mt-0.5 text-[13.5px] leading-relaxed text-ink-muted">{check.detail}</p>
            </div>
            <div className="shrink-0 text-right">
              <p className={cn("text-[14px] font-medium", check.ok ? "text-success" : "text-danger")}>{check.ok ? "Operational" : "Down"}</p>
              {check.ms !== null && <p className="mt-0.5 font-mono text-[12px] text-ink-subtle">{check.ms} ms</p>}
            </div>
          </li>
        ))}
      </ul>

      <div className="prose-doc mt-12">
        <h2 className="font-serif text-[1.5rem] text-ink">If something is down during your exam</h2>
        <p>
          Your code saves on your device while you&apos;re offline and syncs when the connection is back. The timer is kept by the
          server, so tell your invigilator if you lost time: staff can add it back.
        </p>
        <p>
          Planned maintenance is announced by your college. Staff see a detailed per-service view in their console.
        </p>
      </div>
    </div>
  );
}
