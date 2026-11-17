"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type WebcamState =
  | { kind: "idle" }
  | { kind: "requesting" }
  | { kind: "active" }
  | { kind: "denied" }
  | { kind: "unavailable" };

/**
 * Manages a webcam stream for exam proctoring (ADR-0078).
 * Phase 2: captures periodic JPEG snapshots and uploads them to the server.
 * tenantId + attemptId are required for upload; omit to store in memory only.
 */
export function useWebcam(
  enabled: boolean,
  tenantId?: string,
  attemptId?: string,
  snapshotIntervalMs = 60_000,
) {
  const [state, setState] = useState<WebcamState>({ kind: "idle" });
  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

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
    // Upload if wired to an attempt (best-effort, non-fatal)
    if (tenantId && attemptId) {
      const capturedAt = new Date().toISOString();
      canvas.toBlob(
        (blob) => {
          if (!blob) return;
          void fetch(`/api/submission/v1/tenants/${tenantId}/attempts/${attemptId}/snapshots`, {
            method: "POST",
            headers: { "Content-Type": "image/jpeg", "X-Captured-At": capturedAt },
            body: blob,
            cache: "no-store",
          }).catch(() => undefined);
        },
        "image/jpeg",
        0.4,
      );
    }
  }, [tenantId, attemptId]);

  // Stop stream on unmount
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

  return { state, request, capture };
}
