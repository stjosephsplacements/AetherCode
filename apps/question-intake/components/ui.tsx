import clsx from "clsx";
import type { ComponentProps } from "react";

export const field =
  "w-full rounded-[var(--radius-control)] border border-line-strong bg-surface px-3 py-2 text-[14px] text-ink outline-none transition-[border-color,box-shadow] placeholder:text-ink-subtle focus:border-brand focus:ring-4 focus:ring-brand/15";

export function Button({ variant = "primary", className, ...props }: ComponentProps<"button"> & { variant?: "primary" | "secondary" | "ghost" | "danger" }) {
  return (
    <button
      className={clsx(
        "inline-flex h-9 items-center justify-center gap-2 rounded-full px-4 text-[13.5px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        variant === "primary" && "bg-brand text-brand-ink hover:bg-brand-hover",
        variant === "secondary" && "border border-line-strong bg-surface text-ink hover:bg-hover",
        variant === "ghost" && "text-ink-muted hover:bg-hover hover:text-ink",
        variant === "danger" && "border border-danger/40 text-danger hover:bg-danger-soft",
        className,
      )}
      {...props}
    />
  );
}

export function Panel({ className, ...props }: ComponentProps<"section">) {
  return <section className={clsx("rounded-[var(--radius-surface)] border border-line bg-surface p-5 shadow-[var(--shadow-hairline)]", className)} {...props} />;
}

export function Label({ children, hint, htmlFor }: { children: React.ReactNode; hint?: string; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-[13px] font-medium text-ink">
      {children}
      {hint && <span className="ml-2 font-normal text-ink-subtle">{hint}</span>}
    </label>
  );
}
