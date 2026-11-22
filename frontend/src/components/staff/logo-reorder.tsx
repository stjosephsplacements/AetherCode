"use client";

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { ActionState } from "@/components/staff/form";
import { Button } from "@/components/ui/button";

type ReorderContext = {
  logoIds: string[];
  pending: boolean;
  move: (index: number, delta: number) => void;
};

const LogoReorderContext = createContext<ReorderContext | null>(null);

export function LogoReorderScope({
  logoIds,
  reorder,
  children,
}: {
  logoIds: string[];
  reorder: (ids: string[]) => Promise<ActionState>;
  children: ReactNode;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const queue = useRef(Promise.resolve());
  const active = useRef(0);

  const runReorder = useCallback((next: string[]) => {
    active.current++;
    setPending(true);
    queue.current = queue.current.then(async () => {
      setError(null);
      try {
        const state = await reorder(next);
        if (state.error) setError(state.error);
      } catch {
        setError("Logo order could not be saved");
      } finally {
        active.current--;
        if (active.current === 0) setPending(false);
      }
    });
  }, [reorder]);

  const move = useCallback(
    (index: number, delta: number) => {
      if (pending) return;
      const target = index + delta;
      if (target < 0 || target >= logoIds.length) return;
      const next = [...logoIds];
      const current = next[index];
      const other = next[target];
      if (!current || !other) return;
      next[index] = other;
      next[target] = current;
      runReorder(next);
    },
    [logoIds, pending, runReorder],
  );

  return (
    <LogoReorderContext.Provider value={{ logoIds, pending, move }}>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {children}
    </LogoReorderContext.Provider>
  );
}

export function LogoReorderButtons({ index }: { index: number }) {
  const ctx = useContext(LogoReorderContext);
  if (!ctx) throw new Error("LogoReorderButtons must be used inside LogoReorderScope");
  const { logoIds, pending, move } = ctx;
  return (
    <div className="flex shrink-0 flex-col gap-1">
      <Button type="button" variant="secondary" size="sm" disabled={pending || index === 0} onClick={() => move(index, -1)}>
        Up
      </Button>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={pending || index === logoIds.length - 1}
        onClick={() => move(index, 1)}
      >
        Down
      </Button>
    </div>
  );
}