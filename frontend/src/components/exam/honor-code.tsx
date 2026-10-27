"use client";

import { ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";

const PLEDGES = [
  "I'll work alone, without talking to, messaging or sharing code with anyone.",
  "I won't use AI assistants, code generators or solutions from the internet.",
  "I won't share my screen, photograph the questions or copy them out of the exam.",
  "I understand that switching tabs, leaving fullscreen and pasting from outside the editor are recorded.",
  "I understand the exam submits itself when time runs out, and submitted answers are final.",
];

/**
 * The agreement a student signs before an attempt starts. Every pledge must be
 * ticked and the student types their own roll number as a signature.
 */
export function HonorCode({
  open,
  onOpenChange,
  signature,
  onAgree,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** What the student must type: their roll number or username. */
  signature: string;
  onAgree: () => void;
}) {
  const [ticked, setTicked] = useState<boolean[]>(() => PLEDGES.map(() => false));
  const [typed, setTyped] = useState("");
  const signatureId = useId();
  const signed = typed.trim().toLowerCase() === signature.trim().toLowerCase() && signature.trim() !== "";
  const ready = ticked.every(Boolean) && signed;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setTicked(PLEDGES.map(() => false));
          setTyped("");
        }
        onOpenChange(next);
      }}
    >
      <DialogContent title="Exam honor code" description="Read each line and tick it. Your exam starts when you sign.">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (ready) onAgree();
          }}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            <fieldset>
              <legend className="sr-only">Pledges</legend>
              <ul className="space-y-2.5">
                {PLEDGES.map((pledge, index) => (
                  <li key={pledge}>
                    <label className="flex cursor-pointer items-start gap-3 rounded-[var(--radius-control)] border border-line px-3.5 py-3 transition-colors hover:bg-hover has-[:checked]:border-accent/40 has-[:checked]:bg-brand-soft">
                      <input
                        type="checkbox"
                        checked={ticked[index]}
                        onChange={(event) => setTicked((current) => current.map((value, at) => (at === index ? event.target.checked : value)))}
                        className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]"
                      />
                      <span className="text-[14.5px] leading-relaxed text-ink">{pledge}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>

            <div className="mt-6">
              <label htmlFor={signatureId} className="block text-[13px] font-medium text-ink">
                Sign by typing your roll number <span className="font-mono text-ink-muted">{signature}</span>
              </label>
              <input
                id={signatureId}
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                aria-invalid={typed !== "" && !signed}
                className="mt-2 h-11 w-full rounded-[var(--radius-control)] border border-line-strong bg-surface px-3.5 font-mono text-[15px] text-ink outline-none transition-[border-color,box-shadow] focus:border-ink focus:ring-4 focus:ring-ink/10 aria-[invalid=true]:border-danger"
              />
              {typed !== "" && !signed && <p className="mt-1.5 text-[13px] text-danger">That doesn&apos;t match your roll number.</p>}
            </div>

            <p className="mt-5 text-[13px] leading-relaxed text-ink-muted">
              These rules come from the <Link href="/terms#integrity" className="text-ink underline underline-offset-2">terms of use</Link>. Your
              college decides what happens if they&apos;re broken.
            </p>
          </div>
          <footer className="flex items-center justify-between gap-3 border-t border-line px-6 py-3.5">
            <span className="text-[13px] text-ink-subtle">
              {ticked.filter(Boolean).length}/{PLEDGES.length} ticked
            </span>
            <Button type="submit" disabled={!ready}>
              <ShieldCheck />
              I agree, start the exam
            </Button>
          </footer>
        </form>
      </DialogContent>
    </Dialog>
  );
}
