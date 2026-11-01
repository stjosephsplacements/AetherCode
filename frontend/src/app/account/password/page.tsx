import type { Metadata } from "next";
import Image from "next/image";
import { cookies } from "next/headers";
import { ActionForm, Field, TextInput } from "@/components/staff/form";
import { Panel } from "@/components/ui/card";
import { requireViewer } from "@/lib/server/session";
import { PASSWORD_COOKIE } from "@/lib/server/tokens";
import { changePassword } from "./actions";

export const metadata: Metadata = { title: "Change password" };

export default async function ChangePasswordPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  await requireViewer();
  const required = Boolean((await cookies()).get(PASSWORD_COOKIE));
  const { next } = await searchParams;
  return (
    <main className="grid min-h-dvh place-items-center bg-canvas px-4 py-10">
      <div className="w-full max-w-sm animate-enter">
        <Image src="/4.png" alt="AetherCode" width={36} height={36} className="logo-light mx-auto object-contain" />
        <Image src="/3.png" alt="AetherCode" width={36} height={36} className="logo-dark mx-auto object-contain" />
        <h1 className="display mt-6 text-center text-[2rem] text-ink">{required ? "Choose your password" : "Change password"}</h1>
        <p className="mx-auto mt-2 max-w-[34ch] text-center text-sm text-ink-muted">
          {required
            ? "Your password was given to you by your college. Replace it with one only you know before you continue."
            : "Use at least 12 characters. You stay signed in on this device."}
        </p>
        <Panel className="mt-8 p-5">
          <ActionForm action={changePassword} submitLabel="Save password">
            <input type="hidden" name="next" value={next ?? ""} />
            <Field label={required ? "Password you were given" : "Current password"} htmlFor="current-password">
              <TextInput id="current-password" name="current_password" type="password" autoComplete="current-password" required />
            </Field>
            <Field label="New password" htmlFor="new-password" hint="At least 12 characters.">
              <TextInput id="new-password" name="new_password" type="password" autoComplete="new-password" minLength={12} required />
            </Field>
            <Field label="New password again" htmlFor="confirm-password">
              <TextInput id="confirm-password" name="confirm_password" type="password" autoComplete="new-password" minLength={12} required />
            </Field>
          </ActionForm>
        </Panel>
      </div>
    </main>
  );
}
