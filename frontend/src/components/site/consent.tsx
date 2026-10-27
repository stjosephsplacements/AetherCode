"use client";

import { usePathname } from "next/navigation";
import Script from "next/script";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export type Consent = { functional: boolean; analytics: boolean; at: string };

const KEY = "aether-consent";
const OPEN_EVENT = "aether:cookie-settings";
const CHANGE_EVENT = "aether:consent";

export function readConsent(): Consent | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<Consent>;
    return { functional: value.functional === true, analytics: value.analytics === true, at: String(value.at ?? "") };
  } catch {
    return null;
  }
}

function saveConsent(choice: Omit<Consent, "at">) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...choice, at: new Date().toISOString() }));
  } catch {
    // Storage blocked: the choice still applies for this page.
  }
  if (!choice.functional) document.cookie = "aether-theme=; path=/; max-age=0";
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** Opens the preference center; the footer's "Cookie settings" calls this. */
export function openCookieSettings() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

// The snapshot must be stable between renders, so compare the raw string.
let lastRaw: string | null | undefined;
let lastConsent: Consent | null = null;
function snapshot(): Consent | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    raw = null;
  }
  if (raw !== lastRaw) {
    lastRaw = raw;
    lastConsent = readConsent();
  }
  return lastConsent;
}

/** The stored choice; undefined while rendering on the server. */
export function useConsent(): Consent | null | undefined {
  return useSyncExternalStore(subscribe, snapshot, () => undefined);
}

const CATEGORIES = [
  {
    key: "essential",
    title: "Essential",
    body: "Keep you signed in, protect forms from forgery and keep your exam session secure. These are always on.",
  },
  {
    key: "functional",
    title: "Functional",
    body: "Remember your theme and editor preferences on this device.",
  },
  {
    key: "analytics",
    title: "Analytics",
    body: "Google Analytics and Umami count page visits so we can see which pages help. Attempt and student IDs are removed before anything is sent.",
  },
] as const;

function Toggle({ checked, disabled, onChange, label }: { checked: boolean; disabled?: boolean; onChange?: (value: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange?.(!checked)}
      className={cn(
        "relative h-6 w-10 shrink-0 rounded-full transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-60",
        checked ? "bg-brand" : "bg-line-strong",
      )}
    >
      <span
        className={cn(
          "absolute top-1 size-4 rounded-full bg-surface shadow-sm transition-[left] duration-200 ease-[cubic-bezier(0.2,0,0,1)]",
          checked ? "left-5" : "left-1",
        )}
      />
    </button>
  );
}

/** The first-visit banner, the preference center and the analytics it gates. */
export function ConsentManager() {
  const consent = useConsent();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({ functional: false, analytics: false });

  useEffect(() => {
    const show = () => {
      const current = readConsent();
      setDraft({ functional: current?.functional ?? false, analytics: current?.analytics ?? false });
      setOpen(true);
    };
    window.addEventListener(OPEN_EVENT, show);
    return () => window.removeEventListener(OPEN_EVENT, show);
  }, []);

  // Never cover a running exam; nothing optional loads until a choice is made.
  const inExam = pathname.startsWith("/student/attempts/");
  const showBanner = consent === null && !inExam && !open;

  return (
    <>
      {consent?.analytics && <Analytics />}

      {showBanner && (
        <div
          role="region"
          aria-label="Cookie choices"
          className="fixed inset-x-3 bottom-3 z-40 animate-pop sm:inset-x-auto sm:right-5 sm:bottom-5 sm:w-[400px]"
        >
          <div className="rounded-[var(--radius-surface)] border border-line bg-surface/85 p-5 shadow-[var(--shadow-overlay)] backdrop-blur-xl">
            <p className="text-[15px] font-semibold text-ink">Cookies on AetherCode</p>
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-muted">
              We use essential cookies to keep you signed in. With your OK we also remember your preferences and count visits.{" "}
              <a href="/privacy#cookies" className="text-ink underline underline-offset-2">
                Read more
              </a>
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button size="sm" onClick={() => saveConsent({ functional: true, analytics: true })}>
                Accept all
              </Button>
              <Button size="sm" variant="secondary" onClick={() => saveConsent({ functional: false, analytics: false })}>
                Essential only
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setDraft({ functional: false, analytics: false });
                  setOpen(true);
                }}
              >
                Choose
              </Button>
            </div>
          </div>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title="Cookie settings" description="Choose what AetherCode may store on this device. You can change this any time from the footer.">
          <div className="divide-y divide-line overflow-y-auto px-6">
            {CATEGORIES.map((category) => {
              const essential = category.key === "essential";
              const checked = essential ? true : draft[category.key];
              return (
                <div key={category.key} className="flex items-start justify-between gap-6 py-4">
                  <div>
                    <p className="text-sm font-medium text-ink">{category.title}</p>
                    <p className="mt-0.5 text-[13px] leading-relaxed text-ink-muted">{category.body}</p>
                  </div>
                  <Toggle
                    label={category.title}
                    checked={checked}
                    disabled={essential}
                    onChange={essential ? undefined : (value) => setDraft((current) => ({ ...current, [category.key]: value }))}
                  />
                </div>
              );
            })}
          </div>
          <footer className="flex justify-end gap-2 border-t border-line px-6 py-3.5">
            <Button
              variant="secondary"
              onClick={() => {
                saveConsent({ functional: true, analytics: true });
                setOpen(false);
              }}
            >
              Accept all
            </Button>
            <Button
              onClick={() => {
                saveConsent(draft);
                setOpen(false);
              }}
            >
              Save choices
            </Button>
          </footer>
        </DialogContent>
      </Dialog>
    </>
  );
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

type Umami = { track: (payload: (props: Record<string, unknown>) => Record<string, unknown>) => void };

/** GA4 and Umami, loaded only after the visitor opts in. IDs in paths are redacted for both. */
function Analytics() {
  const pathname = usePathname();
  const [umamiReady, setUmamiReady] = useState(false);

  useEffect(() => {
    if (!umamiReady) return;
    const umami = (window as Window & { umami?: Umami }).umami;
    const url = pathname.replace(UUID, ":id");
    umami?.track((props) => ({ ...props, url, referrer: "" }));
  }, [pathname, umamiReady]);

  return (
    <>
      <Script src="https://www.googletagmanager.com/gtag/js?id=G-HQ6HC7XJL0" strategy="afterInteractive" />
      <Script id="google-analytics" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          var redacted = window.location.pathname.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ":id");
          gtag('config', 'G-HQ6HC7XJL0', {
            page_path: redacted,
            page_location: window.location.origin + redacted,
            anonymize_ip: true
          });
        `}
      </Script>
      {/* Auto-tracking would send raw paths; each page view is tracked above instead. */}
      <Script
        src="https://analytics-aethercode.stjosephsplacements.in/script.js"
        data-website-id="b476ff2a-f844-48b6-9bb2-1e9d0a68d001"
        data-auto-track="false"
        strategy="afterInteractive"
        onLoad={() => setUmamiReady(true)}
      />
    </>
  );
}
