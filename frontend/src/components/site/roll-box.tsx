"use client";

import { ArrowUp } from "lucide-react";
import { useRouter } from "next/navigation";

/** The key that hands a typed roll number to the sign-in form, kept out of the URL so it never lands in logs or history. */
export const ROLL_HANDOFF = "aether-roll";

/** The hero's input: type your roll number and go straight to sign-in with it filled in. */
export function RollBox() {
  const router = useRouter();
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const roll = new FormData(event.currentTarget).get("roll")?.toString().trim();
        try {
          if (roll) sessionStorage.setItem(ROLL_HANDOFF, roll);
        } catch {
          // Storage blocked: sign-in still works, the field just starts empty.
        }
        router.push("/login");
      }}
      className="relative mx-auto w-full max-w-[640px]"
    >
      <div aria-hidden className="absolute -inset-6 -z-10 rounded-[40px] bg-[radial-gradient(closest-side,var(--brand-soft),transparent)] opacity-90 blur-xl" />
      <label htmlFor="hero-roll" className="sr-only">
        Your roll number
      </label>
      <div className="rounded-[18px] border border-line-strong bg-surface p-4 text-left shadow-[var(--shadow-panel)] transition-shadow focus-within:shadow-[0_0_0_3px_var(--brand-soft),var(--shadow-panel)]">
        <input
          id="hero-roll"
          name="roll"
          autoComplete="username"
          placeholder="Enter your roll number to sign in..."
          className="w-full bg-transparent text-[16px] text-ink outline-none placeholder:text-ink-subtle"
        />
        <div className="mt-6 flex items-center justify-between text-[13px] text-ink-subtle">
          <span>Your college creates your account</span>
          <button type="submit" aria-label="Continue to sign in" className="grid size-9 place-items-center rounded-full bg-brand text-brand-ink transition-colors hover:bg-brand-hover">
            <ArrowUp className="size-4" />
          </button>
        </div>
      </div>
    </form>
  );
}
