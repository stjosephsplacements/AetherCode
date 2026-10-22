"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import type { AnswerRevision, Attempt, PaperItem } from "@/lib/api-types";
import { APIError, api } from "@/lib/client/api";

export type Draft = { language: string; source: string };
export type SaveState = "saved" | "saving" | "unsaved" | "error" | "closed";

/** Saves this long after the last keystroke. */
const AUTOSAVE_DELAY_MS = 1500;

/**
 * The candidate's code for every question, saved to the server as they type.
 * Each save names the attempt version it builds on and returns the next one,
 * so saves run strictly one after another through a queue.
 */
class AnswerBook {
  private drafts = new Map<string, Draft>();
  private saved = new Map<string, Draft | null>();
  private queue: Promise<void> = Promise.resolve();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<() => void>();
  private revision = 0;
  private closed = false;
  saveState: SaveState = "saved";
  saveError: string | null = null;

  constructor(
    private readonly attemptPath: string,
    private readonly items: PaperItem[],
    public version: number,
  ) {
    for (const item of items) {
      const latest = item.latest_answer;
      const language = latest && item.supported_languages.includes(latest.language) ? latest.language : item.supported_languages[0]!;
      this.drafts.set(item.exam_item_id, { language, source: latest?.source ?? "" });
      this.saved.set(item.exam_item_id, latest ? { language: latest.language, source: latest.source } : null);
    }
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getRevision = () => this.revision;

  draft(itemId: string): Draft {
    return this.drafts.get(itemId)!;
  }

  isAnswered(itemId: string): boolean {
    return (this.drafts.get(itemId)?.source.trim() ?? "") !== "";
  }

  hasUnsaved(): boolean {
    return !this.closed && this.items.some((item) => this.dirty(item.exam_item_id));
  }

  update(itemId: string, patch: Partial<Draft>) {
    this.drafts.set(itemId, { ...this.draft(itemId), ...patch });
    if (!this.closed) {
      this.saveState = this.hasUnsaved() ? "unsaved" : "saved";
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => void this.flush(), AUTOSAVE_DELAY_MS);
    }
    this.changed();
  }

  /** Saves every changed answer; resolves once the server has them. */
  flush(): Promise<void> {
    for (const item of this.items) {
      this.queue = this.queue.then(() => this.saveOne(item.exam_item_id));
    }
    return this.queue;
  }

  dispose() {
    if (this.timer) clearTimeout(this.timer);
  }

  private dirty(itemId: string): boolean {
    const draft = this.drafts.get(itemId);
    const last = this.saved.get(itemId);
    if (!draft) return false;
    if (!last) return draft.source.trim() !== "";
    return draft.source !== last.source || draft.language !== last.language;
  }

  private async saveOne(itemId: string, retried = false): Promise<void> {
    if (this.closed || !this.dirty(itemId)) return;
    const draft = { ...this.draft(itemId) };
    this.setSaveState("saving");
    try {
      const revision = await api<AnswerRevision>(`${this.attemptPath}/answers/${itemId}`, {
        method: "PUT",
        body: { language: draft.language, source: draft.source, expected_attempt_version: this.version },
      });
      this.version = revision.attempt_version;
      this.saved.set(itemId, draft);
      this.saveError = null;
      this.setSaveState(this.hasUnsaved() ? "unsaved" : "saved");
    } catch (error) {
      if (error instanceof APIError && error.status === 409 && !retried) {
        // Our version is stale (another tab saved) or the attempt has ended.
        const attempt = await api<Attempt>(this.attemptPath);
        this.version = attempt.version;
        if (attempt.lifecycle_state === "active" || attempt.lifecycle_state === "created") return this.saveOne(itemId, true);
        this.closed = true;
        this.setSaveState("closed");
        return;
      }
      this.saveError = error instanceof Error ? error.message : "Your code could not be saved.";
      this.setSaveState("error");
    }
  }

  private setSaveState(state: SaveState) {
    this.saveState = state;
    this.changed();
  }

  private changed() {
    this.revision++;
    for (const listener of this.listeners) listener();
  }
}

export type Answers = AnswerBook;

export function useAnswers(attemptPath: string, items: PaperItem[], initialVersion: number): AnswerBook {
  const [book] = useState(() => new AnswerBook(attemptPath, items, initialVersion));
  useSyncExternalStore(book.subscribe, book.getRevision, book.getRevision);

  // Warn before leaving with code the server does not have yet.
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (book.hasUnsaved()) event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("beforeunload", warn);
      book.dispose();
    };
  }, [book]);

  return book;
}
