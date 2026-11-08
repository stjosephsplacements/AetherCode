"use client";

import { type ReactNode } from "react";
import { Skeleton, SkeletonSuspense, SkulletProvider } from "skullet/react";

const THEME = {
  light: { base: "#e8e4df", highlight: "#f0ebe3" },
  dark: { base: "#1e1a35", highlight: "#2a2550" },
  animation: "pulse" as const,
};

/** Wraps a Suspense boundary with skullet's content-aware skeleton. */
export function SkulletBoundary({
  children,
  skeleton,
  id,
  label,
}: {
  children: ReactNode;
  skeleton?: ReactNode;
  id?: string;
  label?: string;
}) {
  return (
    <SkulletProvider theme={THEME} mode="system">
      <SkeletonSuspense id={id} label={label} skeleton={skeleton}>
        {children}
      </SkeletonSuspense>
    </SkulletProvider>
  );
}

/** Client-side skullet Skeleton for data that loads after mount. */
export function SkulletLoading<T>({
  data,
  sample,
  id,
  label,
  children,
}: {
  data: T | null | undefined;
  sample: T;
  id?: string;
  label?: string;
  children: (data: T) => ReactNode;
}) {
  return (
    <SkulletProvider theme={THEME} mode="system">
      <Skeleton data={data} sample={sample} id={id} label={label}>
        {children}
      </Skeleton>
    </SkulletProvider>
  );
}
