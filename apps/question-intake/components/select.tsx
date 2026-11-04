"use client";

import { CaretDown, Check } from "@phosphor-icons/react";
import { Select as SelectPrimitive } from "radix-ui";
import { cn } from "@/lib/cn";

export type Option = { value: string; label: string };

/** A dropdown in the platform's style (never the browser's native one). */
export function Select({ id, value, onValueChange, options, className, placeholder, "aria-label": ariaLabel }: { id?: string; value: string; onValueChange: (value: string) => void; options: Option[]; className?: string; placeholder?: string; "aria-label"?: string }) {
  return (
    <SelectPrimitive.Root value={value || undefined} onValueChange={onValueChange}>
      <SelectPrimitive.Trigger
        id={id}
        aria-label={ariaLabel}
        className={cn(
          "group flex h-10 w-full items-center justify-between gap-2 rounded-[var(--radius-control)] border border-line-strong bg-surface px-3 text-left text-sm text-ink shadow-[var(--shadow-hairline)] outline-none transition-[border-color,box-shadow] hover:border-ink-subtle focus:border-brand focus:ring-4 focus:ring-brand/15 data-[state=open]:border-brand data-[state=open]:ring-4 data-[state=open]:ring-brand/15",
          className,
        )}
      >
        <span className="min-w-0 truncate">
          <SelectPrimitive.Value placeholder={placeholder ?? "Choose"} />
        </span>
        <SelectPrimitive.Icon>
          <CaretDown className="size-4 shrink-0 text-ink-subtle transition-transform duration-200 group-data-[state=open]:rotate-180" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={4}
          className="z-50 max-h-[min(var(--radix-select-content-available-height),320px)] min-w-[var(--radix-select-trigger-width)] origin-[var(--radix-select-content-transform-origin)] animate-pop overflow-hidden rounded-[var(--radius-control)] border border-line-strong bg-surface shadow-[var(--shadow-overlay)]"
        >
          <SelectPrimitive.Viewport className="p-1">
            {options.map((option) => (
              <SelectPrimitive.Item
                key={option.value}
                value={option.value}
                className="relative flex min-h-8 cursor-default select-none items-center rounded-md py-1.5 pl-7 pr-2.5 text-[13.5px] text-ink outline-none data-[highlighted]:bg-hover data-[state=checked]:font-medium"
              >
                <SelectPrimitive.ItemIndicator className="absolute left-2 inline-flex">
                  <Check className="size-3.5 text-brand" />
                </SelectPrimitive.ItemIndicator>
                <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
