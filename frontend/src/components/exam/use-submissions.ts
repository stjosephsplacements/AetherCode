"use client";

import { useCallback, useEffect, useState } from "react";
import type { ItemSubmission, Page } from "@/lib/api-types";
import { api } from "@/lib/client/api";

const PENDING = new Set(["queued", "dispatched"]);

export type SubmissionsByItem = Record<string, ItemSubmission[]>;

/** The submissions of each listed question; a question that fails to load is left out. */
async function fetchSubmissions(attemptPath: string, ids: string[]): Promise<SubmissionsByItem> {
  const pages = await Promise.all(
    ids.map((id) =>
      api<Page<ItemSubmission>>(`${attemptPath}/items/${id}/submissions`)
        .then((page) => [id, page.items] as const)
        .catch(() => null),
    ),
  );
  return Object.fromEntries(pages.filter((entry) => entry !== null));
}

/**
 * Every question's per-question submissions, newest first, refreshed while
 * any is still being judged.
 */
export function useSubmissions(attemptPath: string, itemIds: string[]) {
  const [byItem, setByItem] = useState<SubmissionsByItem>({});

  const refresh = useCallback(
    (only?: string[]) =>
      fetchSubmissions(attemptPath, only ?? itemIds).then((fetched) => setByItem((previous) => ({ ...previous, ...fetched }))),
    [attemptPath, itemIds],
  );

  // Load once, then poll only the questions with a submission still being
  // judged. Each fetch replaces byItem, which schedules the next poll.
  useEffect(() => {
    let stopped = false;
    const pending = Object.entries(byItem)
      .filter(([, items]) => items.some((item) => PENDING.has(item.lifecycle_state)))
      .map(([id]) => id);
    const firstLoad = Object.keys(byItem).length === 0;
    const ids = firstLoad ? itemIds : pending;
    if (ids.length === 0) return;
    const timer = setTimeout(
      () => {
        void fetchSubmissions(attemptPath, ids).then((fetched) => {
          if (!stopped) setByItem((previous) => ({ ...previous, ...fetched }));
        });
      },
      firstLoad ? 0 : 1500,
    );
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [byItem, attemptPath, itemIds]);

  return { byItem, refresh };
}

/** The best completed score of a question's submissions, if any. */
export function bestScore(items: ItemSubmission[] | undefined): number | null {
  const scores = (items ?? []).filter((item) => item.score !== null).map((item) => Number(item.score));
  return scores.length ? Math.max(...scores) : null;
}

export function isJudging(items: ItemSubmission[] | undefined): boolean {
  return (items ?? []).some((item) => PENDING.has(item.lifecycle_state));
}
