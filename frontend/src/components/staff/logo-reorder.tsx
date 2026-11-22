"use client";

import { useTransition } from "react";
import type { ActionState } from "@/components/staff/form";
import { Button } from "@/components/ui/button";

export function LogoReorderButtons({
  logoIds,
  index,
  reorder,
}: {
  logoIds: string[];
  index: number;
  reorder: (ids: string[]) => Promise<ActionState>;
}) {
  const [pending, start] = useTransition();
  const move = (delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= logoIds.length) return;
    const next = [...logoIds];
    const current = next[index];
    const other = next[target];
    if (!current || !other) return;
    next[index] = other;
    next[target] = current;
    start(() => {
      void reorder(next);
    });
  };
  return (
    <div className="flex shrink-0 flex-col gap-1">
      <Button type="button" variant="secondary" size="sm" disabled={pending || index === 0} onClick={() => move(-1)}>
        Up
      </Button>
      <Button type="button" variant="secondary" size="sm" disabled={pending || index === logoIds.length - 1} onClick={() => move(1)}>
        Down
      </Button>
    </div>
  );
}