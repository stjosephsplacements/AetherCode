"use client";

import { LoaderCircle } from "lucide-react";
import { type ComponentProps, useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** The result of a staff server action, shown under its form. */
export type ActionState = { error: string | null; message?: string | null };

export const initialActionState: ActionState = { error: null, message: null };

const control =
  "w-full rounded-[var(--radius-control)] border border-line-strong bg-surface px-3 text-sm text-ink shadow-[var(--shadow-hairline)] outline-none transition-[border-color,box-shadow] placeholder:text-ink-subtle hover:border-ink-subtle focus:border-brand focus:ring-4 focus:ring-brand/15 disabled:opacity-60";

export function Field({ label, hint, htmlFor, className, children }: { label: string; hint?: string; htmlFor: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={htmlFor} className="block text-[13px] font-medium text-ink">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-ink-muted">{hint}</p>}
    </div>
  );
}

export function TextInput({ className, ...props }: ComponentProps<"input">) {
  return <input {...props} className={cn(control, "h-10", className)} />;
}

export function TextArea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea {...props} className={cn(control, "min-h-24 py-2.5 leading-relaxed", className)} />;
}

export function Select({ className, children, ...props }: ComponentProps<"select">) {
  return (
    <select {...props} className={cn(control, "h-10 pr-8", className)}>
      {children}
    </select>
  );
}

export function SubmitButton({ children, variant = "primary", className }: { children: React.ReactNode; variant?: "primary" | "secondary"; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} disabled={pending} className={className}>
      {pending && <LoaderCircle className="animate-spin" />}
      {children}
    </Button>
  );
}

export function FormMessage({ state }: { state: ActionState }) {
  if (state.error) {
    return (
      <p role="alert" className="rounded-[var(--radius-control)] bg-danger-soft px-3 py-2 text-sm text-danger">
        {state.error}
      </p>
    );
  }
  if (state.message) {
    return (
      <p role="status" className="rounded-[var(--radius-control)] bg-success-soft px-3 py-2 text-sm text-success">
        {state.message}
      </p>
    );
  }
  return null;
}

/** A form bound to a staff server action, showing its result underneath. */
export function ActionForm({
  action,
  submitLabel,
  className,
  children,
}: {
  action: (previous: ActionState, form: FormData) => Promise<ActionState>;
  submitLabel: string;
  className?: string;
  children: React.ReactNode;
}) {
  const [state, formAction] = useActionState(action, initialActionState);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.message && !state.error) formRef.current?.reset();
  }, [state]);
  return (
    <form ref={formRef} action={formAction} className={cn("space-y-4", className)}>
      {children}
      <FormMessage state={state} />
      <SubmitButton>{submitLabel}</SubmitButton>
    </form>
  );
}
