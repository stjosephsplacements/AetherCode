"use client";

import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { type ChangedMessage, type HealthMessage, SESSION_EXPIRED, type Topic, backoff, parseMessage, realtimeURL } from "./realtime-protocol";

export type RealtimeStatus = "connecting" | "live" | "offline";

type Listener = (message: ChangedMessage) => void;

type Realtime = {
  status: RealtimeStatus;
  health: HealthMessage | null;
  subscribe: (listener: Listener) => () => void;
};

const Context = createContext<Realtime>({ status: "offline", health: null, subscribe: () => () => {} });

/**
 * One WebSocket to the gateway for the whole console. It reconnects with
 * backoff; when the session expires it lets the server refresh the cookie first.
 */
export function RealtimeProvider({ tenantId, children }: { tenantId: string | null; children: React.ReactNode }) {
  const router = useRouter();
  const [status, setStatus] = useState<RealtimeStatus>("connecting");
  const [health, setHealth] = useState<HealthMessage | null>(null);
  const listeners = useRef(new Set<Listener>());
  const [subscribe] = useState(() => (listener: Listener) => {
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  });

  useEffect(() => {
    if (!tenantId) return;
    let socket: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let stopped = false;

    const connect = () => {
      socket = new WebSocket(realtimeURL(window.location, tenantId, process.env.NEXT_PUBLIC_REALTIME_URL));
      socket.onopen = () => {
        attempt = 0;
        setStatus("live");
      };
      socket.onmessage = (event) => {
        const message = parseMessage(event.data);
        if (message?.type === "health") setHealth(message);
        else if (message) for (const listener of listeners.current) listener(message);
      };
      socket.onclose = (event) => {
        if (stopped) return;
        setStatus("offline");
        // A server render refreshes the session cookie before the next attempt.
        if (event.code === SESSION_EXPIRED) router.refresh();
        timer = setTimeout(
          () => {
            setStatus("connecting");
            connect();
          },
          event.code === SESSION_EXPIRED ? 1000 : backoff(attempt++),
        );
      };
    };
    connect();
    return () => {
      stopped = true;
      clearTimeout(timer);
      socket?.close();
    };
  }, [tenantId, router]);

  return <Context.Provider value={{ status: tenantId ? status : "offline", health, subscribe }}>{children}</Context.Provider>;
}

export function useRealtime(): Realtime {
  return useContext(Context);
}

/**
 * Re-renders the page from the server when a hint for one of `topics` arrives,
 * batching bursts. While the socket is down it falls back to a slow timer.
 */
export function LiveRefresh({ topics, fallbackSeconds = 60 }: { topics: Topic[]; fallbackSeconds?: number }) {
  const router = useRouter();
  const { status, subscribe } = useRealtime();
  const key = topics.join(",");

  useEffect(() => {
    let pending: ReturnType<typeof setTimeout> | undefined;
    const wanted = new Set(key.split(","));
    const stop = subscribe((message) => {
      if (!wanted.has(message.topic)) return;
      clearTimeout(pending);
      pending = setTimeout(() => router.refresh(), 750);
    });
    return () => {
      clearTimeout(pending);
      stop();
    };
  }, [key, router, subscribe]);

  useEffect(() => {
    if (status === "live") return;
    const refresh = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const timer = setInterval(refresh, fallbackSeconds * 1000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [status, fallbackSeconds, router]);

  return null;
}

const LABEL: Record<RealtimeStatus, string> = { live: "Live", connecting: "Connecting", offline: "Offline" };

/** The connection's state in the topbar, so nobody mistakes stale numbers for live ones. */
export function LiveIndicator() {
  const { status } = useRealtime();
  return (
    <span
      role="status"
      className="inline-flex h-7 items-center gap-1.5 rounded-full border border-line px-2.5 font-mono text-[11px] uppercase tracking-[0.06em] text-ink-muted"
    >
      <span
        aria-hidden
        className={status === "live" ? "size-1.5 rounded-full bg-success" : status === "connecting" ? "size-1.5 animate-pulse rounded-full bg-warning" : "size-1.5 rounded-full bg-ink-subtle"}
      />
      {LABEL[status]}
    </span>
  );
}
