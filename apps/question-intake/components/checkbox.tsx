"use client";

import { Check } from "@phosphor-icons/react";
import clsx from "clsx";
import { Checkbox as CheckboxPrimitive } from "radix-ui";

/** A checkbox in the platform's style. */
export function Checkbox({ className, ...props }: import("react").ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      {...props}
      className={clsx(
        "grid size-[18px] shrink-0 place-items-center rounded-[5px] border border-line-strong bg-surface text-brand-ink shadow-[var(--shadow-hairline)] transition-[background-color,border-color] hover:border-ink-subtle data-[state=checked]:border-brand data-[state=checked]:bg-brand",
        className,
      )}
    >
      <CheckboxPrimitive.Indicator className="animate-pop">
        <Check className="size-3.5" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}
