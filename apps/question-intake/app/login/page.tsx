import { Stack } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import { LoginForm } from "./form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ expired?: string }> }) {
  const { expired } = await searchParams;
  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="w-full max-w-[420px] rounded-[var(--radius-surface)] border border-line bg-surface p-7 shadow-[var(--shadow-panel)]">
        <span className="grid size-11 place-items-center rounded-full bg-brand-soft text-brand">
          <Stack className="size-5" weight="duotone" />
        </span>
        <h1 className="mt-4 text-[22px] font-semibold tracking-tight">Question intake</h1>
        <p className="mt-1 mb-6 text-[14px] text-ink-muted">Sign in with your AetherCode staff account to upload questions.</p>
        <LoginForm expired={expired === "1"} />
      </div>
    </main>
  );
}
