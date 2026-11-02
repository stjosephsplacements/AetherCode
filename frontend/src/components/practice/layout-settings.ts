"use client";

import { useSyncExternalStore } from "react";

/** How the problem, editor and console are arranged. Kept in this browser only. */
export type WorkspaceLayout = {
  /** Problem on the right instead of the left. */
  swap: boolean;
  /** Console under the editor, or beside it. */
  console: "bottom" | "right";
  /** Width of the problem pane, in percent of the row. */
  problemPct: number;
  /** Size of the console, in percent of the editor column. */
  consolePct: number;
  /** Hide the problem to give the editor the whole width. */
  focus: boolean;
};

const KEY = "aethercode.workspace-layout";
export const DEFAULT_LAYOUT: WorkspaceLayout = { swap: false, console: "bottom", problemPct: 40, consolePct: 38, focus: false };

let current: WorkspaceLayout | null = null;
const listeners = new Set<() => void>();

function read(): WorkspaceLayout {
  if (current) return current;
  try {
    current = { ...DEFAULT_LAYOUT, ...(JSON.parse(window.localStorage.getItem(KEY) ?? "null") as Partial<WorkspaceLayout> | null) };
  } catch {
    current = DEFAULT_LAYOUT;
  }
  return current;
}

export function updateLayout(patch: Partial<WorkspaceLayout>) {
  current = { ...read(), ...patch };
  try {
    if (JSON.parse(window.localStorage.getItem("aether-consent") ?? "{}").functional === true) window.localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // Storage may be refused; the layout still applies now.
  }
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useLayout = (): WorkspaceLayout => useSyncExternalStore(subscribe, read, () => DEFAULT_LAYOUT);
