import { type VariantProps, cva } from "class-variance-authority";
import { Slot } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap rounded-full font-medium transition-[background-color,color,border-color,box-shadow,transform] duration-200 ease-[cubic-bezier(0.2,0,0,1)] active:translate-y-px disabled:pointer-events-none disabled:opacity-45 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-brand text-brand-ink shadow-[var(--shadow-hairline)] hover:bg-brand-hover",
        secondary: "border border-line-strong bg-surface text-ink hover:bg-hover",
        ghost: "text-ink-muted hover:bg-hover hover:text-ink",
        quiet: "bg-hover text-ink hover:bg-line",
      },
      size: {
        sm: "h-8 px-3.5 text-[13px]",
        md: "h-9 px-4.5 text-sm",
        lg: "h-11 px-6 text-[15px]",
        icon: "size-8",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Component = asChild ? Slot.Root : "button";
  return <Component className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
