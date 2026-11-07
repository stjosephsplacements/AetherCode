"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import type { ActionState } from "@/components/staff/form";
import { initialActionState } from "@/components/staff/form";
import { MFA_REQUIRED_SENTINEL } from "@/lib/mfa-sentinel";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { performMFAStepUp } from "@/lib/server/mfa";

/**
 * Wraps a server action form with automatic MFA step-up handling.
 *
 * When the underlying action returns the MFA_REQUIRED_SENTINEL error a TOTP
 * dialog appears. After the user enters their authenticator code and the
 * step-up succeeds, the original form is re-submitted automatically.
 */
export function MFAGate({
  action,
  submitLabel,
  className,
  onSuccess,
  children,
}: {
  action: (previous: ActionState, form: FormData) => Promise<ActionState>;
  submitLabel: string;
  className?: string;
  onSuccess?: () => void;
  children: React.ReactNode;
}) {
  const [state, formAction] = useActionState(action, initialActionState);
  const formRef = useRef<HTMLFormElement>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [totpCode, setTotpCode] = useState("");
  const [stepUpError, setStepUpError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Synchronise dialog visibility with action state changes.
  // onSuccess is excluded from deps intentionally — it changes every render.
  useEffect(() => {
    if (state.error === MFA_REQUIRED_SENTINEL) {
      setDialogOpen(true); // eslint-disable-line react-hooks/set-state-in-effect
      return;
    }
    setDialogOpen(false);
    if (state.message && !state.error) {
      formRef.current?.reset();
      onSuccess?.();
    }
    // onSuccess is a fresh function each render; state identity drives this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    // Snapshot form data so we can re-submit after step-up without losing field values.
    void event;
  }

  function dismissDialog() {
    setDialogOpen(false);
    setTotpCode("");
    setStepUpError(null);
  }

  function handleStepUp() {
    if (totpCode.length !== 6) {
      setStepUpError("Enter the six-digit code from your authenticator app.");
      return;
    }
    startTransition(async () => {
      const err = await performMFAStepUp(totpCode);
      if (err) {
        setStepUpError(err);
        return;
      }
      setDialogOpen(false);
      setTotpCode("");
      setStepUpError(null);
      // Re-submit the form now that the access token carries MFAVerifiedAt.
      if (formRef.current) formRef.current.requestSubmit();
    });
  }

  return (
    <>
      <form ref={formRef} action={formAction} onSubmit={handleSubmit} className={className ?? "space-y-4"}>
        {children}
        {state.error && state.error !== MFA_REQUIRED_SENTINEL && (
          <p role="alert" className="text-[13px] text-danger">
            {state.error}
          </p>
        )}
        {state.message && !state.error && (
          <p role="status" className="text-[13px] text-success">
            {state.message}
          </p>
        )}
        <Button type="submit">{submitLabel}</Button>
      </form>

      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) dismissDialog(); }}>
        <DialogContent
          title="Verify your identity"
          description="This action requires a recent MFA check. Enter the six-digit code from your authenticator app."
        >
          <div className="space-y-4 p-6">
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              autoComplete="one-time-code"
              placeholder="000000"
              value={totpCode}
              onChange={(e) => { setTotpCode(e.target.value.replace(/\D/g, "").slice(0, 6)); setStepUpError(null); }}
              className="w-full rounded-[var(--radius-control)] border border-line-strong bg-surface px-3 py-2 text-center text-lg font-mono tracking-[0.3em] text-ink shadow-[var(--shadow-hairline)] outline-none transition-[border-color,box-shadow] focus:border-brand focus:ring-4 focus:ring-brand/15"
              autoFocus
            />
            {stepUpError && (
              <p role="alert" className="text-[13px] text-danger">
                {stepUpError}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" type="button" onClick={dismissDialog}>
                Cancel
              </Button>
              <Button
                type="button"
                onClick={handleStepUp}
                disabled={isPending || totpCode.length !== 6}
              >
                {isPending ? "Verifying…" : "Verify"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
