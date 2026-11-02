"use client";

import { Eraser, GripHorizontal, NotebookPen, Pause, Play, Plus, RotateCcw, StickyNote, Timer, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/* ---------- storage: this browser only, kept when functional cookies are allowed ---------- */

const memory = new Map<string, string>();
const listeners = new Set<() => void>();
const allowed = () => {
  try {
    return JSON.parse(window.localStorage.getItem("aether-consent") ?? "{}").functional === true;
  } catch {
    return false;
  }
};
function read(key: string, fallback: string): string {
  if (memory.has(key)) return memory.get(key)!;
  let value = fallback;
  try {
    value = window.localStorage.getItem(key) ?? fallback;
  } catch {
    // storage refused
  }
  memory.set(key, value);
  return value;
}
function write(key: string, value: string) {
  memory.set(key, value);
  if (allowed()) {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // storage refused; it still works for this visit
    }
  }
  for (const listener of listeners) listener();
}
function useStored(key: string, fallback: string): [string, (value: string) => void] {
  const value = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => read(key, fallback),
    () => fallback,
  );
  return [value, (next) => write(key, next)];
}

/* ---------- the tools ---------- */

const COLORS = [
  { name: "yellow", bg: "bg-[#fff3a8] dark:bg-[#5c5214]", ink: "text-[#3d3500] dark:text-[#fff3a8]" },
  { name: "pink", bg: "bg-[#ffd0dc] dark:bg-[#5c2236]", ink: "text-[#5a1229] dark:text-[#ffd0dc]" },
  { name: "blue", bg: "bg-[#cfe6ff] dark:bg-[#1d3a5c]", ink: "text-[#0f2f55] dark:text-[#cfe6ff]" },
  { name: "green", bg: "bg-[#d3f5d8] dark:bg-[#1f4a2a]", ink: "text-[#12391b] dark:text-[#d3f5d8]" },
] as const;
type Note = { id: string; color: number; text: string };
const clock = (seconds: number) => {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h > 0 ? `${h}:` : ""}${String(m).padStart(h > 0 ? 2 : 1, "0")}:${String(s % 60).padStart(2, "0")}`;
};

/** A stopwatch that keeps running between questions, with a countdown you can set for yourself. */
function useTimer(key: string) {
  const [state, setState] = useStored(`${key}.timer`, JSON.stringify({ elapsed: 0, since: null, goal: 0 }));
  const parsed = JSON.parse(state) as { elapsed: number; since: number | null; goal: number };
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (parsed.since === null) return;
    const first = setTimeout(() => setNow(Date.now()), 0);
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [parsed.since]);
  const seconds = parsed.elapsed + (parsed.since === null ? 0 : Math.max(0, now - parsed.since) / 1000);
  const save = (next: Partial<typeof parsed>) => setState(JSON.stringify({ ...parsed, ...next }));
  const notified = useRef(false);
  useEffect(() => {
    if (parsed.goal > 0 && seconds >= parsed.goal && !notified.current) {
      notified.current = true;
      toast("Your timer is up.");
    }
    if (parsed.goal === 0 || seconds < parsed.goal) notified.current = false;
  }, [seconds, parsed.goal]);
  return {
    seconds,
    running: parsed.since !== null,
    goal: parsed.goal,
    start: () => {
      setNow(Date.now());
      save({ since: Date.now() });
    },
    pause: () => save({ elapsed: seconds, since: null }),
    reset: () => save({ elapsed: 0, since: null }),
    setGoal: (goal: number) => save({ goal }),
  };
}

/**
 * A timer, sticky notes and a scratch pad in one small window you can drag anywhere. Everything stays in
 * this browser and is kept per problem. `storageKey` names the problem, so each has its own notes.
 */
export function WorkspaceTools({ storageKey }: { storageKey: string }) {
  const key = `aethercode.tools.${storageKey}`;
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"timer" | "notes" | "scratch">("timer");
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const timer = useTimer(key);
  const [notesJson, setNotes] = useStored(`${key}.notes`, "[]");
  const notes = JSON.parse(notesJson) as Note[];
  const [scratch, setScratch] = useStored(`${key}.scratch`, "");
  const drag = useRef<{ x: number; y: number } | null>(null);

  const saveNotes = useCallback((next: Note[]) => setNotes(JSON.stringify(next)), [setNotes]);

  return (
    <>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => {
            setTab("timer");
            setOpen(true);
          }}
          aria-label="Open the timer"
          className={cn("inline-flex h-8 items-center gap-1.5 rounded-full px-3 font-mono text-[12.5px] tabular-nums transition-colors", timer.running ? "bg-brand-soft text-brand-soft-ink" : "bg-hover text-ink-muted hover:text-ink")}
        >
          <Timer className="size-3.5" />
          {clock(timer.seconds)}
        </button>
        <button type="button" onClick={() => (setTab("notes"), setOpen(true))} aria-label="Sticky notes" className="relative grid size-8 place-items-center rounded-full text-ink-muted transition-colors hover:bg-hover hover:text-ink">
          <StickyNote className="size-4" strokeWidth={1.75} />
          {notes.length > 0 && <span className="absolute -right-0.5 -top-0.5 grid size-4 place-items-center rounded-full bg-brand text-[10px] font-semibold text-brand-ink">{notes.length}</span>}
        </button>
        <button type="button" onClick={() => (setTab("scratch"), setOpen(true))} aria-label="Scratch pad" className="grid size-8 place-items-center rounded-full text-ink-muted transition-colors hover:bg-hover hover:text-ink">
          <NotebookPen className="size-4" strokeWidth={1.75} />
        </button>
      </div>

      {open && (
        <div role="dialog" aria-label="Workspace tools" className="fixed bottom-5 right-5 z-40 w-[340px] max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-3xl border border-line-strong bg-surface shadow-[var(--shadow-overlay)]" style={{ transform: `translate(${position.x}px, ${position.y}px)` }}>
          <div
            className="flex cursor-grab touch-none items-center gap-2 border-b border-line px-3 py-2 active:cursor-grabbing"
            onPointerDown={(event) => {
              drag.current = { x: event.clientX - position.x, y: event.clientY - position.y };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => drag.current && setPosition({ x: event.clientX - drag.current.x, y: event.clientY - drag.current.y })}
            onPointerUp={() => (drag.current = null)}
          >
            <GripHorizontal className="size-4 text-ink-subtle" />
            <div role="tablist" className="flex flex-1 gap-1" onPointerDown={(event) => event.stopPropagation()}>
              {(
                [
                  ["timer", "Timer"],
                  ["notes", "Notes"],
                  ["scratch", "Scratch"],
                ] as const
              ).map(([value, label]) => (
                <button key={value} role="tab" aria-selected={tab === value} onClick={() => setTab(value)} className={cn("rounded-full px-3 py-1 text-[12.5px] font-medium transition-colors", tab === value ? "bg-hover text-ink" : "text-ink-muted hover:text-ink")}>
                  {label}
                </button>
              ))}
            </div>
            <button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={() => setOpen(false)} aria-label="Close" className="grid size-7 place-items-center rounded-full text-ink-muted hover:bg-hover hover:text-ink">
              <X className="size-4" />
            </button>
          </div>

          {tab === "timer" && (
            <div className="p-4">
              <p className="text-center font-mono text-[44px] font-semibold tabular-nums leading-none text-ink">{clock(timer.seconds)}</p>
              {timer.goal > 0 && (
                <p className={cn("mt-2 text-center text-[12.5px]", timer.seconds >= timer.goal ? "font-medium text-danger" : "text-ink-muted")}>{timer.seconds >= timer.goal ? "Your goal time is up" : `${clock(timer.goal - timer.seconds)} left of your ${Math.round(timer.goal / 60)} min goal`}</p>
              )}
              <div className="mt-4 flex justify-center gap-2">
                <button type="button" onClick={timer.running ? timer.pause : timer.start} className="inline-flex h-10 items-center gap-2 rounded-full bg-brand px-5 text-sm font-semibold text-brand-ink hover:bg-brand-hover">
                  {timer.running ? <Pause className="size-4" /> : <Play className="size-4" />}
                  {timer.running ? "Pause" : timer.seconds > 0 ? "Resume" : "Start"}
                </button>
                <button type="button" onClick={timer.reset} aria-label="Reset the timer" className="grid size-10 place-items-center rounded-full border border-line text-ink-muted hover:bg-hover hover:text-ink">
                  <RotateCcw className="size-4" />
                </button>
              </div>
              <div className="mt-4 border-t border-line pt-3">
                <p className="mb-2 text-[12px] text-ink-muted">Goal for this problem</p>
                <div className="flex flex-wrap gap-1.5">
                  {[0, 15, 30, 45, 60].map((minutes) => (
                    <button key={minutes} type="button" onClick={() => timer.setGoal(minutes * 60)} aria-pressed={timer.goal === minutes * 60} className={cn("rounded-full px-3 py-1 text-[12.5px] font-medium transition-colors", timer.goal === minutes * 60 ? "bg-brand-soft text-brand-soft-ink" : "bg-hover text-ink-muted hover:text-ink")}>
                      {minutes === 0 ? "None" : `${minutes} min`}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {tab === "notes" && (
            <div className="max-h-[360px] space-y-2.5 overflow-y-auto p-3">
              {notes.length === 0 && <p className="px-1 py-6 text-center text-[13px] text-ink-muted">No notes yet. Jot down an idea, an edge case or a thing to check.</p>}
              {notes.map((note) => {
                const color = COLORS[note.color % COLORS.length]!;
                return (
                  <div key={note.id} className={cn("rounded-2xl p-3 shadow-sm", color.bg)}>
                    <textarea
                      value={note.text}
                      onChange={(event) => saveNotes(notes.map((entry) => (entry.id === note.id ? { ...entry, text: event.target.value } : entry)))}
                      rows={3}
                      maxLength={2000}
                      aria-label="Note"
                      placeholder="Write something"
                      className={cn("w-full resize-none bg-transparent text-[13.5px] leading-snug outline-none placeholder:opacity-50", color.ink)}
                    />
                    <div className="mt-1 flex items-center justify-between">
                      <div className="flex gap-1.5">
                        {COLORS.map((option, index) => (
                          <button key={option.name} type="button" aria-label={`Colour it ${option.name}`} onClick={() => saveNotes(notes.map((entry) => (entry.id === note.id ? { ...entry, color: index } : entry)))} className={cn("size-4 rounded-full border border-black/20", option.bg, note.color === index && "ring-2 ring-ink/60")} />
                        ))}
                      </div>
                      <button type="button" aria-label="Delete the note" onClick={() => saveNotes(notes.filter((entry) => entry.id !== note.id))} className={cn("rounded-full p-1 opacity-70 hover:opacity-100", color.ink)}>
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
              <button type="button" disabled={notes.length >= 12} onClick={() => saveNotes([...notes, { id: crypto.randomUUID(), color: notes.length % COLORS.length, text: "" }])} className="flex w-full items-center justify-center gap-1.5 rounded-2xl border border-dashed border-line-strong py-2.5 text-[13px] font-medium text-ink-muted transition-colors hover:border-brand hover:text-brand disabled:opacity-50">
                <Plus className="size-4" />
                Add a note
              </button>
            </div>
          )}

          {tab === "scratch" && (
            <div className="p-3">
              <textarea value={scratch} onChange={(event) => setScratch(event.target.value)} spellCheck={false} aria-label="Scratch pad" maxLength={20000} placeholder="Work things out here: pseudocode, small examples, arithmetic. It is never submitted." className="h-[280px] w-full resize-none rounded-2xl border border-line bg-canvas p-3 font-mono text-[12.5px] leading-relaxed text-ink outline-none placeholder:text-ink-subtle focus:border-brand focus:ring-4 focus:ring-brand/15" />
              <div className="mt-2 flex items-center justify-between text-[12px] text-ink-subtle">
                <span>{scratch.length} characters. Never submitted.</span>
                <button type="button" onClick={() => setScratch("")} disabled={!scratch} className="inline-flex items-center gap-1 text-ink-muted hover:text-ink disabled:opacity-40">
                  <Eraser className="size-3.5" />
                  Clear
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
