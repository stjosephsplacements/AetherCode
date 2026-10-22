import type { ComponentProps, ReactNode } from "react";

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(" ");

type Variant = "primary" | "secondary" | "go" | "ghost" | "danger";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-ink text-canvas hover:bg-ink-soft",
  secondary: "bg-surface text-ink border border-line-strong hover:bg-sunken",
  go: "bg-go text-white hover:bg-go-hover",
  ghost: "text-muted hover:text-ink hover:bg-sunken",
  danger: "bg-surface text-error border border-error/30 hover:bg-error-soft",
};

export function buttonClass(variant: Variant = "primary", size: "sm" | "md" = "md") {
  return cx(
    "inline-flex items-center justify-center gap-2 rounded-full font-semibold transition-colors disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap",
    size === "sm" ? "h-8 px-3.5 text-[13px]" : "h-10 px-5 text-sm",
    VARIANTS[variant],
  );
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ComponentProps<"button"> & { variant?: Variant; size?: "sm" | "md" }) {
  return <button className={cx(buttonClass(variant, size), className)} {...props} />;
}

export function Card({ className, ...props }: ComponentProps<"div">) {
  return <div className={cx("rounded-2xl border border-line bg-surface", className)} {...props} />;
}

export const inputClass =
  "w-full rounded-xl border border-line-strong bg-surface px-3.5 py-2.5 text-sm text-ink placeholder:text-faint focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/10";

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-semibold text-ink">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-faint">{hint}</span>}
    </label>
  );
}


type Tone = "neutral" | "brand" | "pass" | "fail" | "error" | "accent";
const TONES: Record<Tone, string> = {
  neutral: "bg-sunken text-muted",
  brand: "bg-brand-soft text-brand-ink",
  pass: "bg-pass-soft text-pass",
  fail: "bg-fail-soft text-fail",
  error: "bg-error-soft text-error",
  accent: "bg-accent-soft text-accent",
};

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={cx("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold", TONES[tone])}>{children}</span>
  );
}

export function PageHeader({ eyebrow, title, actions }: { eyebrow?: string; title: string; actions?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        {eyebrow && <p className="mb-1 text-xs font-semibold uppercase tracking-[0.14em] text-accent">{eyebrow}</p>}
        <h1 className="font-display text-3xl font-semibold tracking-tight text-ink sm:text-4xl">{title}</h1>
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-2.5 font-display text-lg font-semibold tracking-tight text-ink", className)}>
      <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden="true">
        <defs>
          <linearGradient id="ac-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#e04090" />
            <stop offset="50%" stopColor="#f07030" />
            <stop offset="100%" stopColor="#f0a020" />
          </linearGradient>
        </defs>
        {/* Double-chevron mark */}
        <path d="M10 6l-8 10 8 10" fill="none" stroke="url(#ac-grad)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M22 6l8 10-8 10" fill="none" stroke="url(#ac-grad)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M13 6l-5 10 5 10" fill="none" stroke="url(#ac-grad)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.5" />
        <path d="M19 6l5 10-5 10" fill="none" stroke="url(#ac-grad)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.5" />
      </svg>
      AetherCode
    </span>
  );
}

export { cx };
