"use client";

import { Check } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { Button } from "./button";
import { DialogContent } from "./dialog";
import { draftFields } from "@/lib/drafts";
import { cn } from "@/lib/utils";

type Step = { title: string; content: ReactNode };

const draftStorageKey = (key: string) => `aether-draft:${key}`;

function restoreFields(form: HTMLFormElement, fields: Record<string, string[]>) {
  for (const element of Array.from(form.elements)) {
    if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement)) continue;
    const values = fields[element.name];
    if (!element.name || !values || element.type === "file" || element.type === "hidden") continue;
    if (element instanceof HTMLInputElement && (element.type === "checkbox" || element.type === "radio")) {
      element.checked = values.includes(element.value);
    } else if (element instanceof HTMLSelectElement && element.multiple) {
      for (const option of Array.from(element.options)) option.selected = values.includes(option.value);
    } else {
      element.value = values[0] ?? "";
    }
  }
}

/** Typing Enter here should insert text, not advance the wizard. */
function keepsEnter(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target instanceof HTMLTextAreaElement || target.isContentEditable || target.tagName === "BUTTON" || !!target.closest(".monaco-editor");
}

/**
 * A multi-step form in a modal: numbered steps, Enter advances, Esc closes, and
 * unsent input survives closing the dialog (sessionStorage, per draftKey).
 * Every step stays mounted, so one submit carries all fields to the action.
 * Render it inside a <Dialog>.
 */
export function StepDialog({
  title,
  description,
  steps,
  action,
  draftKey,
  submitLabel,
  pending = false,
  error,
}: {
  title: string;
  description?: ReactNode;
  steps: Step[];
  action: (formData: FormData) => void;
  draftKey: string;
  submitLabel: string;
  pending?: boolean;
  error?: string;
}) {
  const [index, setIndex] = useState(0);
  const form = useRef<HTMLFormElement>(null);
  const panels = useRef<(HTMLFieldSetElement | null)[]>([]);
  const last = index === steps.length - 1;

  useEffect(() => {
    if (!form.current) return;
    try {
      const saved = sessionStorage.getItem(draftStorageKey(draftKey));
      if (saved) restoreFields(form.current, JSON.parse(saved));
    } catch {
      // A blocked or corrupt draft just means starting empty.
    }
  }, [draftKey]);

  const saveDraft = () => {
    if (!form.current) return;
    try {
      sessionStorage.setItem(draftStorageKey(draftKey), JSON.stringify(draftFields(new FormData(form.current))));
    } catch {
      // Storage full or blocked: the draft is a convenience only.
    }
  };

  // Native validation, but only for the visible step.
  const stepValid = useCallback((at: number) => {
    const invalid = panels.current[at]?.querySelector<HTMLInputElement>(":invalid");
    if (!invalid) return true;
    invalid.reportValidity();
    return false;
  }, []);

  const next = () => {
    if (stepValid(index)) setIndex((current) => Math.min(current + 1, steps.length - 1));
  };

  const goTo = (target: number) => {
    // Going back is always allowed; going forward checks each step on the way.
    for (let at = index; at < target; at++) if (!stepValid(at)) return setIndex(at);
    setIndex(target);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing || keepsEnter(event.target)) return;
    if (!last) {
      event.preventDefault();
      next();
    }
  };

  return (
    <DialogContent title={title} description={description} className="w-[min(94vw,760px)]">
      <ol className="flex items-center gap-2 border-b border-line px-6 py-3" aria-label="Steps">
        {steps.map((step, at) => (
          <li key={step.title} className="flex min-w-0 items-center gap-2">
            {at > 0 && <span aria-hidden className={cn("h-px w-6 shrink-0", at <= index ? "bg-brand/60" : "bg-line-strong")} />}
            <button
              type="button"
              onClick={() => goTo(at)}
              aria-current={at === index ? "step" : undefined}
              className={cn(
                "flex min-w-0 items-center gap-2 rounded-full py-1 pl-1 pr-3 text-[13px] transition-colors",
                at === index ? "bg-brand-soft text-ink" : "text-ink-muted hover:text-ink",
              )}
            >
              <span
                className={cn(
                  "grid size-5 shrink-0 place-items-center rounded-full font-mono text-[11px]",
                  at < index ? "bg-brand text-brand-ink" : at === index ? "bg-brand text-brand-ink" : "border border-line-strong",
                )}
              >
                {at < index ? <Check className="size-3" strokeWidth={3} /> : at + 1}
              </span>
              <span className="truncate">{step.title}</span>
            </button>
          </li>
        ))}
      </ol>

      <form
        ref={form}
        action={action}
        onInput={saveDraft}
        onChange={saveDraft}
        onKeyDown={onKeyDown}
        onSubmit={(event) => {
          for (let at = 0; at < steps.length; at++) {
            if (!stepValid(at)) {
              event.preventDefault();
              setIndex(at);
              return;
            }
          }
          try {
            sessionStorage.removeItem(draftStorageKey(draftKey));
          } catch {
            // Nothing to clear.
          }
        }}
        className="flex min-h-0 flex-1 flex-col"
        noValidate
      >
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {steps.map((step, at) => (
            <fieldset
              key={step.title}
              ref={(element) => {
                panels.current[at] = element;
              }}
              hidden={at !== index}
              className="space-y-4"
            >
              <legend className="sr-only">{step.title}</legend>
              {step.content}
            </fieldset>
          ))}
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-line px-6 py-3.5">
          <p className="min-w-0 truncate text-[13px] text-danger" role="alert">
            {error}
          </p>
          <div className="flex shrink-0 items-center gap-2">
            <span className="mr-1 hidden font-mono text-xs text-ink-subtle sm:inline">
              {index + 1}/{steps.length}
            </span>
            {index > 0 && (
              <Button type="button" variant="ghost" onClick={() => setIndex(index - 1)}>
                Back
              </Button>
            )}
            {last ? (
              <Button type="submit" disabled={pending}>
                {pending ? "Saving…" : submitLabel}
              </Button>
            ) : (
              <Button type="button" onClick={next}>
                Continue
              </Button>
            )}
          </div>
        </footer>
      </form>
    </DialogContent>
  );
}
