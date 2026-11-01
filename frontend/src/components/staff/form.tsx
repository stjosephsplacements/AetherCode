"use client";

import { CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, LoaderCircle, Paperclip } from "lucide-react";
import { Checkbox as CheckboxPrimitive, Popover, RadioGroup as RadioGroupPrimitive, Select as SelectPrimitive } from "radix-ui";
import { Children, type ComponentProps, isValidElement, type ReactElement, type ReactNode, useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { TIME_ZONE, cn } from "@/lib/utils";

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

/** Number and date-time fields get the console's own stepper and picker instead of the browser's. */
export function TextInput({ className, ...props }: ComponentProps<"input">) {
  if (props.type === "number") return <NumberInput className={className} {...props} />;
  if (props.type === "datetime-local") return <DateTimeInput className={className} {...props} />;
  return <input {...props} className={cn(control, "h-10", className)} />;
}

export function TextArea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea {...props} className={cn(control, "min-h-24 py-2.5 leading-relaxed", className)} />;
}

/** Puts `setValue(initial)` on the surrounding form's reset, the way native fields reset. */
function useFormReset(input: React.RefObject<HTMLInputElement | null>, reset: () => void) {
  const latest = useRef(reset);
  useEffect(() => {
    latest.current = reset;
  });
  useEffect(() => {
    const form = input.current?.form;
    if (!form) return;
    const onReset = () => latest.current();
    form.addEventListener("reset", onReset);
    return () => form.removeEventListener("reset", onReset);
  }, [input]);
}

/**
 * Carries a custom control's value into the form. It is a real, invisible text
 * input under the control, so `required` still blocks submit and points here.
 */
function FormValue({ ref, name, value, required }: { ref: React.Ref<HTMLInputElement>; name?: string; value: string; required?: boolean }) {
  return (
    <input
      ref={ref}
      name={name}
      value={value}
      required={required}
      onChange={() => {}}
      tabIndex={-1}
      aria-hidden
      className="pointer-events-none absolute inset-x-0 bottom-0 h-px w-full opacity-0"
    />
  );
}

type Option = { value: string; label: ReactNode; disabled?: boolean };

// Radix reserves "" for "no value", so an empty option travels under this key.
const EMPTY = "__empty__";

function optionsFrom(children: ReactNode): Option[] {
  return Children.toArray(children)
    .filter((child): child is ReactElement<ComponentProps<"option">> => isValidElement(child) && child.type === "option")
    .map(({ props }) => ({ value: String(props.value ?? ""), label: props.children, disabled: props.disabled }));
}

/**
 * A select that takes the same <option> children as the native one. Like the
 * native one, it starts on the first option when no value is given.
 */
export function Select({
  id,
  name,
  value,
  defaultValue,
  onValueChange,
  required,
  disabled,
  size = "md",
  className,
  children,
  "aria-label": ariaLabel,
}: {
  id?: string;
  name?: string;
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  required?: boolean;
  disabled?: boolean;
  size?: "sm" | "md";
  className?: string;
  children: ReactNode;
  "aria-label"?: string;
}) {
  const options = optionsFrom(children);
  const initial = defaultValue ?? options[0]?.value ?? "";
  const [own, setOwn] = useState(initial);
  const current = value ?? own;
  const input = useRef<HTMLInputElement>(null);
  useFormReset(input, () => setOwn(initial));
  return (
    <div className={cn("relative", size === "md" && "w-full", className)}>
      <SelectPrimitive.Root
        value={options.some((option) => option.value === current) ? current || EMPTY : undefined}
        onValueChange={(next) => {
          const chosen = next === EMPTY ? "" : next;
          // The hidden field holds the value before a caller reads the form (the college switcher submits it on
          // change); state catches up on the next render. No forced render: Radix may call this during one.
          if (input.current) input.current.value = chosen;
          setOwn(chosen);
          onValueChange?.(chosen);
        }}
        disabled={disabled}
      >
        <SelectPrimitive.Trigger
          id={id}
          aria-label={ariaLabel}
          className={cn(
            control,
            "group flex items-center justify-between gap-2 text-left data-[placeholder]:text-ink-subtle data-[state=open]:border-brand data-[state=open]:ring-4 data-[state=open]:ring-brand/15",
            size === "sm" ? "h-8 pl-2.5 pr-2 text-[13px]" : "h-10 pr-2.5",
          )}
        >
          <span className="min-w-0 truncate">
            <SelectPrimitive.Value placeholder="Choose" />
          </span>
          <SelectPrimitive.Icon>
            <ChevronDown className="size-4 shrink-0 text-ink-subtle transition-transform duration-200 group-data-[state=open]:rotate-180" strokeWidth={1.75} />
          </SelectPrimitive.Icon>
        </SelectPrimitive.Trigger>
        <SelectPrimitive.Portal>
          <SelectPrimitive.Content
            position="popper"
            sideOffset={4}
            className="z-50 max-h-[min(var(--radix-select-content-available-height),320px)] min-w-[var(--radix-select-trigger-width)] max-w-[min(92vw,440px)] origin-[var(--radix-select-content-transform-origin)] animate-pop overflow-hidden rounded-[var(--radius-control)] border border-line-strong bg-surface shadow-[var(--shadow-overlay)]"
          >
            <SelectPrimitive.ScrollUpButton className="flex h-6 items-center justify-center text-ink-subtle">
              <ChevronUp className="size-4" strokeWidth={1.75} />
            </SelectPrimitive.ScrollUpButton>
            <SelectPrimitive.Viewport className="p-1">
              {options.length === 0 && <p className="px-2.5 py-2 text-[13px] text-ink-muted">Nothing to choose yet.</p>}
              {options.map((option) => (
                <SelectPrimitive.Item
                  key={option.value || EMPTY}
                  value={option.value || EMPTY}
                  disabled={option.disabled}
                  className="relative flex min-h-8 cursor-default select-none items-center rounded-md py-1.5 pl-7 pr-2.5 text-[13.5px] text-ink outline-none data-[disabled]:opacity-45 data-[highlighted]:bg-hover data-[state=checked]:font-medium"
                >
                  <SelectPrimitive.ItemIndicator className="absolute left-2 inline-flex">
                    <Check className="size-3.5 text-brand" strokeWidth={2.5} />
                  </SelectPrimitive.ItemIndicator>
                  <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                </SelectPrimitive.Item>
              ))}
            </SelectPrimitive.Viewport>
            <SelectPrimitive.ScrollDownButton className="flex h-6 items-center justify-center text-ink-subtle">
              <ChevronDown className="size-4" strokeWidth={1.75} />
            </SelectPrimitive.ScrollDownButton>
          </SelectPrimitive.Content>
        </SelectPrimitive.Portal>
      </SelectPrimitive.Root>
      <FormValue ref={input} name={name} value={current} required={required} />
    </div>
  );
}

/** A checkbox that submits like a native one ("on", or its `value`). */
export function Checkbox({ className, ...props }: ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      {...props}
      className={cn(
        "grid size-[18px] shrink-0 place-items-center rounded-[5px] border border-line-strong bg-surface text-brand-ink shadow-[var(--shadow-hairline)] transition-[background-color,border-color] hover:border-ink-subtle disabled:opacity-50 data-[state=checked]:border-brand data-[state=checked]:bg-brand",
        className,
      )}
    >
      <CheckboxPrimitive.Indicator className="animate-pop">
        <Check className="size-3.5" strokeWidth={3} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export const RadioGroup = RadioGroupPrimitive.Root;

export function Radio({ className, ...props }: ComponentProps<typeof RadioGroupPrimitive.Item>) {
  return (
    <RadioGroupPrimitive.Item
      {...props}
      className={cn(
        "grid size-[18px] shrink-0 place-items-center rounded-full border border-line-strong bg-surface transition-colors hover:border-ink-subtle data-[state=checked]:border-brand",
        className,
      )}
    >
      <RadioGroupPrimitive.Indicator className="size-2 animate-pop rounded-full bg-brand" />
    </RadioGroupPrimitive.Item>
  );
}

/** A number field with its own stepper; the input stays native so min, max and step still validate. */
function NumberInput({ className, ...props }: ComponentProps<"input">) {
  const input = useRef<HTMLInputElement>(null);
  const step = (direction: 1 | -1) => {
    const element = input.current;
    if (!element || element.disabled) return;
    if (direction === 1) element.stepUp();
    else element.stepDown();
    // stepUp skips React's value tracking, so this input event reaches onChange.
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.focus();
  };
  return (
    <div className={cn("relative h-10 w-full", className)}>
      <input
        ref={input}
        {...props}
        className={cn(control, "h-full pr-8 tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none")}
      />
      <div className="absolute inset-y-px right-px flex w-6 flex-col overflow-hidden rounded-r-[calc(var(--radius-control)-1px)] border-l border-line">
        {([1, -1] as const).map((direction) => (
          <button
            key={direction}
            type="button"
            tabIndex={-1}
            aria-label={direction === 1 ? "Increase" : "Decrease"}
            onClick={() => step(direction)}
            className={cn("grid flex-1 place-items-center text-ink-subtle transition-colors hover:bg-hover hover:text-ink active:bg-line", direction === -1 && "border-t border-line")}
          >
            {direction === 1 ? <ChevronUp className="size-3" strokeWidth={2} /> : <ChevronDown className="size-3" strokeWidth={2} />}
          </button>
        ))}
      </div>
    </div>
  );
}

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const MONTH = new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
const SHOWN = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" });
const TODAY = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE });
const pad = (value: number) => String(value).padStart(2, "0");

/** "2026-11-03T14:30" into its parts; the value is college wall-clock time, so no zone math happens here. */
function parseLocal(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number) as [number, number, number, number, number];
  return { year, month: month - 1, day, hour, minute };
}

/** A date and time picker that submits the same "YYYY-MM-DDTHH:mm" a datetime-local field does. */
function DateTimeInput({ id, name, defaultValue, value: controlled, required, disabled, className, "aria-label": ariaLabel }: ComponentProps<"input">) {
  const initial = String(controlled ?? defaultValue ?? "");
  const [value, setValue] = useState(initial);
  const [open, setOpen] = useState(false);
  const parts = parseLocal(value);
  const todayKey = TODAY.format(new Date());
  const [view, setView] = useState(() => {
    const at = parts ?? parseLocal(`${todayKey}T00:00`)!;
    return { year: at.year, month: at.month };
  });
  const input = useRef<HTMLInputElement>(null);
  useFormReset(input, () => setValue(initial));

  const set = (next: { year: number; month: number; day: number; hour: number; minute: number }) =>
    setValue(`${next.year}-${pad(next.month + 1)}-${pad(next.day)}T${pad(next.hour)}:${pad(next.minute)}`);
  const time = { hour: parts?.hour ?? 9, minute: parts?.minute ?? 0 };

  const first = new Date(Date.UTC(view.year, view.month, 1));
  const lead = (first.getUTCDay() + 6) % 7;
  const cells = Array.from({ length: 42 }, (_, index) => new Date(Date.UTC(view.year, view.month, index - lead + 1)));
  const minutes = [...new Set([...Array.from({ length: 12 }, (_, index) => index * 5), time.minute])].sort((a, b) => a - b);
  const shift = (by: number) => {
    const next = new Date(Date.UTC(view.year, view.month + by, 1));
    setView({ year: next.getUTCFullYear(), month: next.getUTCMonth() });
  };

  return (
    <div className={cn("relative w-full", className)}>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger
          id={id}
          aria-label={ariaLabel}
          disabled={disabled}
          className={cn(control, "flex h-10 items-center gap-2.5 text-left data-[state=open]:border-brand data-[state=open]:ring-4 data-[state=open]:ring-brand/15")}
        >
          <CalendarDays className="size-4 shrink-0 text-ink-subtle" strokeWidth={1.75} />
          <span className={cn("min-w-0 truncate tabular-nums", !parts && "text-ink-subtle")}>
            {parts ? SHOWN.format(new Date(Date.UTC(parts.year, parts.month, parts.day, parts.hour, parts.minute))) : "Pick a date and time"}
          </span>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="start"
            sideOffset={4}
            collisionPadding={12}
            className="z-50 w-[300px] origin-[var(--radix-popover-content-transform-origin)] animate-pop rounded-[var(--radius-surface)] border border-line-strong bg-surface p-3 shadow-[var(--shadow-overlay)] outline-none"
          >
            <div className="mb-2 flex items-center justify-between">
              <button type="button" aria-label="Previous month" onClick={() => shift(-1)} className="grid size-8 place-items-center rounded-[var(--radius-control)] text-ink-muted transition-colors hover:bg-hover hover:text-ink">
                <ChevronLeft className="size-4" strokeWidth={1.75} />
              </button>
              <p className="text-sm font-semibold text-ink" aria-live="polite">
                {MONTH.format(first)}
              </p>
              <button type="button" aria-label="Next month" onClick={() => shift(1)} className="grid size-8 place-items-center rounded-[var(--radius-control)] text-ink-muted transition-colors hover:bg-hover hover:text-ink">
                <ChevronRight className="size-4" strokeWidth={1.75} />
              </button>
            </div>
            <div className="grid grid-cols-7 text-center font-mono text-[10.5px] uppercase text-ink-subtle">
              {WEEKDAYS.map((day) => (
                <span key={day} className="py-1">
                  {day}
                </span>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-0.5" role="grid" aria-label={MONTH.format(first)}>
              {cells.map((cell) => {
                const key = cell.toISOString().slice(0, 10);
                const chosen = parts !== null && key === `${parts.year}-${pad(parts.month + 1)}-${pad(parts.day)}`;
                const outside = cell.getUTCMonth() !== view.month;
                return (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={chosen}
                    aria-label={key}
                    onClick={() => set({ year: cell.getUTCFullYear(), month: cell.getUTCMonth(), day: cell.getUTCDate(), ...time })}
                    className={cn(
                      "grid h-9 place-items-center rounded-[var(--radius-control)] text-[13px] tabular-nums transition-colors",
                      chosen ? "bg-brand font-semibold text-brand-ink" : "hover:bg-hover",
                      !chosen && (outside ? "text-ink-subtle/60" : "text-ink"),
                      !chosen && key === todayKey && "ring-1 ring-inset ring-brand/60",
                    )}
                  >
                    {cell.getUTCDate()}
                  </button>
                );
              })}
            </div>
            <div className="mt-3 flex items-center gap-2 border-t border-line pt-3">
              <span className="mr-auto font-mono text-[11px] uppercase tracking-[0.08em] text-ink-subtle">Time</span>
              <Select
                size="sm"
                aria-label="Hour"
                className="w-[84px]"
                value={String(time.hour)}
                disabled={!parts}
                onValueChange={(hour) => parts && set({ ...parts, hour: Number(hour) })}
              >
                {Array.from({ length: 24 }, (_, hour) => (
                  <option key={hour} value={String(hour)}>
                    {hour % 12 || 12} {hour < 12 ? "am" : "pm"}
                  </option>
                ))}
              </Select>
              <span className="text-ink-subtle">:</span>
              <Select
                size="sm"
                aria-label="Minute"
                className="w-[68px]"
                value={String(time.minute)}
                disabled={!parts}
                onValueChange={(minute) => parts && set({ ...parts, minute: Number(minute) })}
              >
                {minutes.map((minute) => (
                  <option key={minute} value={String(minute)}>
                    {pad(minute)}
                  </option>
                ))}
              </Select>
            </div>
            <div className="mt-3 flex items-center justify-between">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  const today = parseLocal(`${todayKey}T00:00`)!;
                  setView({ year: today.year, month: today.month });
                  set({ ...today, ...time });
                }}
              >
                Today
              </Button>
              <div className="flex gap-1.5">
                {!required && parts && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => setValue("")}>
                    Clear
                  </Button>
                )}
                <Button type="button" size="sm" onClick={() => setOpen(false)}>
                  Done
                </Button>
              </div>
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      <FormValue ref={input} name={name} value={value} required={required} />
    </div>
  );
}

/** A file field: a button and the chosen file's name, the native input kept invisible underneath. */
export function FileInput({ className, ...props }: Omit<ComponentProps<"input">, "type">) {
  const [file, setFile] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useFormReset(input, () => setFile(null));
  return (
    <label className={cn("relative inline-flex min-w-0 cursor-pointer items-center gap-3 text-sm", className)}>
      <input
        ref={input}
        {...props}
        type="file"
        onChange={(event) => {
          setFile(event.target.files?.[0]?.name ?? null);
          props.onChange?.(event);
        }}
        className="peer pointer-events-none absolute inset-x-0 bottom-0 h-px w-full opacity-0"
      />
      <span className="inline-flex h-9 shrink-0 items-center gap-2 rounded-full border border-line-strong bg-surface px-4 font-medium text-ink transition-colors hover:bg-hover peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand">
        <Paperclip className="size-4" strokeWidth={1.75} />
        Choose file
      </span>
      <span className={cn("min-w-0 truncate", file ? "font-mono text-[12.5px] text-ink" : "text-ink-muted")}>{file ?? "No file chosen"}</span>
    </label>
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
