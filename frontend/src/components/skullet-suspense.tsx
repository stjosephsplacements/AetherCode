"use client";

import { type ReactNode } from "react";
import { SkeletonSuspense, SkulletProvider } from "skullet/react";

const THEME = {
  light: { base: "#e8e4df", highlight: "#f0ebe3" },
  dark: { base: "#1e1a35", highlight: "#2a2550" },
  animation: "pulse" as const,
};

/** Wraps a Suspense boundary with skullet's content-aware skeleton. */
export function SkulletSuspense({
  children,
  skeleton,
  id,
  label,
}: {
  children: ReactNode;
  /** Sample content to measure for the skeleton shape. */
  skeleton?: ReactNode;
  id?: string;
  label?: string;
}) {
  return (
    <SkulletProvider theme={THEME}>
      <SkeletonSuspense id={id} label={label} skeleton={skeleton}>
        {children}
      </SkeletonSuspense>
    </SkulletProvider>
  );
}
