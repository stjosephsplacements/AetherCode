import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** A placeholder block. Give it the size of what it stands in for, so nothing shifts on load. */
export function Skeleton({ className, ...props }: ComponentProps<"div">) {
  return <div aria-hidden className={cn("animate-pulse rounded-[var(--radius-control)] bg-hover", className)} {...props} />;
}
