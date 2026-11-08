"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { Announcement, AttemptLiveState } from "@/lib/api-types";
import { api } from "@/lib/client/api";
import { useRealtime } from "@/lib/client/realtime";

const FALLBACK_MS = 30_000;

/**
 * The parts of an attempt staff change while it runs (ADR-0027): the deadline,
 * when they grant extra time, and announcements. Refreshes immediately on a
 * WebSocket hint (attempts topic); falls back to polling every 30 seconds when
 * the socket is offline.
 */
export function useLiveState(attemptPath: string, initialDeadline: string) {
  const [deadline, setDeadline] = useState(initialDeadline);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [integrity, setIntegrity] = useState({ requireFullscreen: false, blockExternalPaste: false, webcamRequired: false });
  const seen = useRef<Set<string> | null>(null);
  const { status, subscribe } = useRealtime();

  useEffect(() => {
    let cancelled = false;
    let pending: ReturnType<typeof setTimeout> | undefined;
    async function poll() {
      const live = await api<AttemptLiveState>(`${attemptPath}/live`).catch(() => null);
      if (!live || cancelled) return;
      setDeadline((previous) => {
        const added = Date.parse(live.submission_deadline) - Date.parse(previous);
        if (added >= 60_000) toast(`Your teacher added ${Math.round(added / 60_000)} minutes.`);
        return live.submission_deadline;
      });
      if (seen.current) {
        for (const note of live.announcements) if (!seen.current.has(note.id)) toast.info(note.body, { duration: 15_000 });
      }
      seen.current = new Set(live.announcements.map((note) => note.id));
      setAnnouncements(live.announcements);
      setIntegrity((current) =>
        current.requireFullscreen === live.require_fullscreen && current.blockExternalPaste === live.block_external_paste && current.webcamRequired === live.webcam_required
          ? current
          : { requireFullscreen: live.require_fullscreen, blockExternalPaste: live.block_external_paste, webcamRequired: live.webcam_required },
      );
    }
    void poll();

    const stop = subscribe((message) => {
      if (message.topic !== "attempts") return;
      clearTimeout(pending);
      pending = setTimeout(poll, 500);
    });

    const timer = status === "live" ? undefined : setInterval(poll, FALLBACK_MS);
    return () => {
      cancelled = true;
      clearTimeout(pending);
      clearInterval(timer);
      stop();
    };
  }, [attemptPath, status, subscribe]);

  return { deadline, announcements, integrity };
}
