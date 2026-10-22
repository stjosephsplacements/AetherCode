"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";
import { Field, FormMessage, Select, SubmitButton, TextArea, initialActionState } from "@/components/staff/form";
import { Badge } from "@/components/ui/card";
import type { ModelCheck } from "@/lib/api-types";
import { cn, formatTime, languageName } from "@/lib/utils";
import { startModelCheck } from "../actions";

const VERDICT_TONE: Record<string, "success" | "danger" | "warning" | "neutral"> = {
  accepted: "success",
  wrong_answer: "danger",
  runtime_error: "danger",
  compile_error: "danger",
  time_limit_exceeded: "warning",
  memory_limit_exceeded: "warning",
};

/**
 * Check a reference solution against every test, hidden ones included, before
 * publishing: a wrong expected output shows up as a failing test here, not in
 * an exam.
 */
export function ModelCheckPanel({ versionId, languages, checks }: { versionId: string; languages: string[]; checks: ModelCheck[] }) {
  const router = useRouter();
  const [state, action] = useActionState(startModelCheck, initialActionState);
  const running = checks.some((check) => check.lifecycle_state === "queued");
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(timer);
  }, [running, router]);

  return (
    <div className="space-y-5">
      <form action={action} className="space-y-4">
        <input type="hidden" name="version_id" value={versionId} />
        <Field label="Language" htmlFor="check-language">
          <Select id="check-language" name="language" className="max-w-56">
            {languages.map((language) => (
              <option key={language} value={language}>
                {languageName(language)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Model solution" htmlFor="check-source" hint="Runs on every test, hidden ones included, with this question's limits.">
          <TextArea id="check-source" name="source" required spellCheck={false} className="min-h-48 font-mono text-xs" />
        </Field>
        <FormMessage state={state} />
        <SubmitButton>Check solution</SubmitButton>
      </form>

      {checks.length > 0 && (
        <ul className="space-y-2">
          {checks.map((check) => (
            <li key={check.id} className="rounded-[var(--radius-control)] border border-line bg-surface px-4 py-3">
              <div className="flex flex-wrap items-center gap-2 text-[13px] text-ink-muted">
                <span className="font-mono tabular-nums">{formatTime(check.requested_at)}</span>
                <span className="text-ink">{languageName(check.language)}</span>
                {check.lifecycle_state === "queued" ? (
                  <Badge>Running</Badge>
                ) : check.lifecycle_state === "failed" ? (
                  <Badge tone="danger">Could not run</Badge>
                ) : (
                  <Badge tone={check.units.every((unit) => unit.verdict === "accepted") ? "success" : "danger"}>
                    {check.units.filter((unit) => unit.verdict === "accepted").length} of {check.units.length} tests pass
                  </Badge>
                )}
              </div>
              {check.units.length > 0 && (
                <ol className="mt-2 flex flex-wrap gap-1.5">
                  {check.units.map((unit) => (
                    <li
                      key={unit.unit_number}
                      title={`Test ${unit.unit_number + 1}: ${unit.verdict.replaceAll("_", " ")}${unit.time_ms !== undefined ? `, ${unit.time_ms} ms` : ""}`}
                      className={cn(
                        "rounded-md px-2 py-0.5 font-mono text-[11px]",
                        VERDICT_TONE[unit.verdict] === "success" && "bg-success-soft text-success",
                        VERDICT_TONE[unit.verdict] === "danger" && "bg-danger-soft text-danger",
                        VERDICT_TONE[unit.verdict] === "warning" && "bg-warning-soft text-warning",
                        !VERDICT_TONE[unit.verdict] && "bg-hover text-ink-muted",
                      )}
                    >
                      {unit.unit_number + 1} {unit.verdict === "accepted" ? "pass" : unit.verdict.replaceAll("_", " ")}
                    </li>
                  ))}
                </ol>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
