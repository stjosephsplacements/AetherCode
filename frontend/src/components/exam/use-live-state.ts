"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { Announcement, AttemptLiveState } from "@/lib/api-types";
import { api } from "@/lib/client/api";

const POLL_MS = 15_000;

/**
 * The parts of an attempt staff change while it runs (ADR-0027): the deadline,
 * when they grant extra time, and announcements. Polled every 15 seconds; a
 * failed poll keeps the last known state.
 */
export function useLiveState(attemptPath: string, initialDeadline: string) {
  const [deadline, setDeadline] = useState(initialDeadline);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [integrity, setIntegrity] = useState({ requireFullscreen: false, blockExternalPaste: false });
  const seen = useRef<Set<string> | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      const live = await api<AttemptLiveState>(`${attemptPath}/live`).catch(() => null);
      if (!live || cancelled) return;
      setDeadline((previous) => {
        const added = Date.parse(live.submission_deadline) - Date.parse(previous);
        if (added >= 60_000) toast(`Your teacher added ${Math.round(added / 60_000)} minutes.`);
        return live.submission_deadline;
      });
      // Announcements made before the screen opened show in the banner, but
      // only new ones pop up.
      if (seen.current) {
        for (const note of live.announcements) if (!seen.current.has(note.id)) toast.info(note.body, { duration: 15_000 });
      }
      seen.current = new Set(live.announcements.map((note) => note.id));
      setAnnouncements(live.announcements);
      setIntegrity((current) =>
        current.requireFullscreen === live.require_fullscreen && current.blockExternalPaste === live.block_external_paste
          ? current
          : { requireFullscreen: live.require_fullscreen, blockExternalPaste: live.block_external_paste },
      );
    }
    void poll();
    const timer = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [attemptPath]);

  return { deadline, announcements, integrity };
}
