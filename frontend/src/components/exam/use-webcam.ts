"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type WebcamState =
  | { kind: "idle" }
  | { kind: "requesting" }
  | { kind: "active" }
  | { kind: "denied" }
  | { kind: "unavailable" };

/**
 * Manages a webcam stream for exam proctoring. Captures periodic snapshots
 * into an in-memory ring buffer. No server upload in phase 1 (ADR-0078).
 */
export function useWebcam(enabled: boolean, snapshotIntervalMs = 60_000) {
  const [state, setState] = useState<WebcamState>({ kind: "idle" });
  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const snapshotsRef = useRef<string[]>([]);
  const snapshotCountRef = useRef(0);

  const request = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setState({ kind: "unavailable" });
      return;
    }
    setState({ kind: "requesting" });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: 320, height: 240 },
      });
      streamRef.current = stream;
      const video = document.createElement("video");
      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;
      void video.play().catch(() => undefined);
      videoRef.current = video;
      canvasRef.current = document.createElement("canvas");
      setState({ kind: "active" });
    } catch {
      setState({ kind: "denied" });
    }
  }, []);

  const capture = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0);
    snapshotsRef.current = [...snapshotsRef.current.slice(-9), canvas.toDataURL("image/jpeg", 0.4)];
    snapshotCountRef.current = snapshotsRef.current.length;
  }, []);

  // Stop stream on unmount or when state leaves active
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      videoRef.current = null;
    };
  }, []);

  // Periodic snapshots when active
  useEffect(() => {
    if (state.kind !== "active" || !enabled) return;
    capture();
    const timer = setInterval(capture, snapshotIntervalMs);
    return () => clearInterval(timer);
  }, [state.kind, enabled, capture, snapshotIntervalMs]);

  // Auto-start if enabled — defer to microtask to avoid setState-in-effect
  useEffect(() => {
    if (!enabled || state.kind !== "idle") return;
    const id = setTimeout(() => void request(), 0);
    return () => clearTimeout(id);
  }, [enabled, state.kind, request]);

  return {
    state,
    request,
    snapshots: snapshotsRef,
    capture,
  };
}
