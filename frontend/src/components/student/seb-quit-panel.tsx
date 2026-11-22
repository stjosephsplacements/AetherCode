"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { api, APIError } from "@/lib/client/api";

const storageKey = "ac_seb_quit_token";

export function SebQuitPanel({ tenantId, visible }: { tenantId: string | null; visible: boolean }) {
  const [password, setPassword] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!visible || !tenantId) return;
    const token = sessionStorage.getItem(storageKey);
    if (!token) {
      setError("Your quit code is not on this device. Ask your invigilator if SEB still will not close.");
      return;
    }
    let cancelled = false;
    setLoading(true);
    api<{ quit_password: string }>(`/seb/v1/tenants/${tenantId}/quit-self`, {
      method: "POST",
      body: { quit_token: token },
    })
      .then((response) => {
        if (!cancelled) {
          setPassword(response.quit_password);
          sessionStorage.removeItem(storageKey);
        }
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        if (caught instanceof APIError) {
          setError(caught.message);
        } else {
          setError("The quit code could not be verified.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tenantId, visible]);

  if (!visible) return null;
  return (
    <section className="mb-6 rounded-panel border border-line bg-surface p-5 shadow-[var(--shadow-panel)]" aria-live="polite">
      <h2 className="text-lg font-semibold text-ink">Leave Safe Exam Browser</h2>
      <p className="mt-2 text-sm text-ink-muted">
        Your exam has been handed in. Use the quit password below when SEB asks for it (Quit SEB or the key combination your college uses).
      </p>
      {loading && <p className="mt-3 text-sm text-ink-muted">Preparing your quit password…</p>}
      {error && (
        <p role="alert" className="mt-3 rounded-xl bg-error-soft px-4 py-3 text-sm font-medium text-error">
          {error}
        </p>
      )}
      {password && <PasswordReveal password={password} />}
    </section>
  );
}

export function storeSebQuitToken(token: string) {
  sessionStorage.setItem(storageKey, token);
}

function PasswordReveal({ password }: { password: string }) {
  const [shown, setShown] = useState(false);
  return (
    <div className="mt-4 flex flex-wrap items-center gap-3">
      <code className="rounded-control bg-hover px-3 py-2 font-mono text-sm">{shown ? password : "•".repeat(12)}</code>
      <Button variant="secondary" size="sm" onClick={() => setShown((value) => !value)}>
        {shown ? "Hide" : "Show"}
      </Button>
    </div>
  );
}