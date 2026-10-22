"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import type { Audience } from "@/lib/api-types";
import { cn } from "@/lib/utils";
import { setAudience } from "../actions";

const OPTIONS: { value: Audience; label: string }[] = [
  { value: "test", label: "Tests" },
  { value: "practice", label: "Practice" },
];

/** Where a question may be used: in exams only, or open to students as practice (ADR-0041). */
export function AudienceSwitch({ questionId, versionId, initial }: { questionId: string; versionId: string; initial: Audience }) {
  const [audience, setCurrent] = useState(initial);
  const [pending, startTransition] = useTransition();

  function choose(next: Audience) {
    if (next === audience || pending) return;
    if (next === "practice" && !window.confirm("Students in every college will see this question and its sample tests. Never move a question that an upcoming exam uses. Continue?")) return;
    startTransition(async () => {
      const result = await setAudience(questionId, versionId, next);
      if (result.error) return void toast.error(result.error);
      setCurrent(next);
      toast.success(result.message);
    });
  }

  return (
    <div role="radiogroup" aria-label="Use this question for" className={cn("inline-flex rounded-full bg-hover p-0.5", pending && "opacity-60")}>
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={audience === option.value}
          disabled={pending}
          onClick={() => choose(option.value)}
          className={cn(
            "rounded-full px-3 py-1 text-[13px] transition-colors",
            audience === option.value ? "bg-surface font-medium text-ink shadow-sm" : "text-ink-muted hover:text-ink",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
