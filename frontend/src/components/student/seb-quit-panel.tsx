"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { api, APIError } from "@/lib/client/api";

const storageKey = "ac_seb_quit_token";

function readQuitToken(): string | null {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem(storageKey);
}

export function SebQuitPanel({ tenantId, visible }: { tenantId: string | null; visible: boolean }) {
  const token = useSyncExternalStore(() => () => {}, readQuitToken, () => null);
  if (!visible) return null;

  const missingToken =
    tenantId && !token ? "Your quit code is not on this device. Ask your invigilator if SEB still will not close." : null;
  if (missingToken) {
    return (
      <section className="mb-6 rounded-panel border border-line bg-surface p-5 shadow-[var(--shadow-panel)]" aria-live="polite">
        <h2 className="text-lg font-semibold text-ink">Leave Safe Exam Browser</h2>
        <p className="mt-2 text-sm text-ink-muted">
          Your exam has been handed in. Use the quit password below when SEB asks for it (Quit SEB or the key combination your college uses).
        </p>
        <p role="alert" className="mt-3 rounded-xl bg-error-soft px-4 py-3 text-sm font-medium text-error">
          {missingToken}
        </p>
      </section>
    );
  }
  if (!tenantId || !token) return null;
  return <SebQuitFetcher tenantId={tenantId} token={token} />;
}

function SebQuitFetcher({ tenantId, token }: { tenantId: string; token: string }) {
  const [password, setPassword] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api<{ quit_password: string }>(`/seb/v1/tenants/${tenantId}/quit-self`, {
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
      });
    return () => {
      cancelled = true;
    };
  }, [tenantId, token]);

  const loading = !password && !error;

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