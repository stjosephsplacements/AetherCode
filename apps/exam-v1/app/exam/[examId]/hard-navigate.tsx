"use client";

import { useEffect } from "react";

/** Replaces the page with a full document load of `href`, bypassing the client router. */
export function HardNavigate({ href }: { href: string }) {
  useEffect(() => window.location.replace(href), [href]);
  return null;
}
