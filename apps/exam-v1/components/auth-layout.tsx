import type { ReactNode } from "react";
import { Logo } from "./ui";

export function AuthLayout({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <main className="relative isolate grid min-h-dvh place-items-center px-4 py-10">
      <div className="auth-bg absolute inset-0 -z-10" />
      {/* Decorative arcs */}
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute right-[-20%] top-[10%] h-[80vh] w-[80vh] rounded-full border border-white/10" />
        <div className="absolute right-[-10%] top-[20%] h-[60vh] w-[60vh] rounded-full border border-white/[0.06]" />
      </div>
      <div className="w-full max-w-[400px]">
        <div className="auth-card rounded-3xl border border-white/20 p-8 shadow-2xl backdrop-blur-xl">
          <div className="mb-6 flex justify-center">
            <Logo />
          </div>
          <h1 className="text-center font-display text-2xl font-semibold tracking-tight text-ink">
            {title}
          </h1>
          <p className="mb-8 mt-2 text-center text-sm text-muted">{subtitle}</p>
          {children}
        </div>
      </div>
    </main>
  );
}
