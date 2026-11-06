"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { performMFAStepUp } from "@/lib/server/mfa";

/**
 * Asks for an authenticator code when an elevated action needs recent MFA. On success the caller
 * submits the form again; the session's access token then carries the fresh MFA time.
 */
export function StepUpDialog({ open, onClose, onVerified }: { open: boolean; onClose: () => void; onVerified: () => void }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function close() {
    setCode("");
    setError(null);
    onClose();
  }

  function verify() {
    if (code.length !== 6) {
      setError("Enter the six-digit code from your authenticator app.");
      return;
    }
    startTransition(async () => {
      const failed = await performMFAStepUp(code);
      if (failed) {
        setError(failed);
        return;
      }
      setCode("");
      setError(null);
      onVerified();
    });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) close(); }}>
      <DialogContent title="Verify your identity" description="This action requires a recent MFA check. Enter the six-digit code from your authenticator app.">
        <div className="space-y-4 p-6">
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            autoComplete="one-time-code"
            aria-label="Authenticator code"
            placeholder="000000"
            value={code}
            onChange={(event) => { setCode(event.target.value.replace(/\D/g, "").slice(0, 6)); setError(null); }}
            className="w-full rounded-[var(--radius-control)] border border-line-strong bg-surface px-3 py-2 text-center font-mono text-lg tracking-[0.3em] text-ink shadow-[var(--shadow-hairline)] outline-none transition-[border-color,box-shadow] focus:border-brand focus:ring-4 focus:ring-brand/15"
            autoFocus
          />
          {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" type="button" onClick={close}>Cancel</Button>
            <Button type="button" onClick={verify} disabled={pending}>{pending ? "Checking..." : "Verify"}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
