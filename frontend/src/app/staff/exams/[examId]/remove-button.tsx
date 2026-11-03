"use client";

import { CircleNotch, X } from "@phosphor-icons/react/ssr";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { ActionState } from "@/components/staff/form";

/**
 * Takes a question or an empty section out of a draft exam. Nothing is lost: it
 * can be added again, so there is no reason to give, unlike deleting an exam.
 */
export function RemoveFromExam({ label, remove }: { label: string; remove: () => Promise<ActionState> }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <span className="inline-flex items-center gap-2">
      {error && <span role="alert" className="max-w-56 truncate text-xs text-danger" title={error}>{error}</span>}
      <button
        type="button"
        aria-label={label}
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await remove();
            if (result.error) return setError(result.error);
            router.refresh();
          })
        }
        className="grid size-7 place-items-center rounded-[var(--radius-control)] text-ink-subtle transition-colors hover:bg-danger-soft hover:text-danger disabled:opacity-50"
      >
        {pending ? <CircleNotch className="size-3.5 animate-spin" /> : <X className="size-4" />}
      </button>
    </span>
  );
}
