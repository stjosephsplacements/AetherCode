import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Panel } from "@/components/ui/card";
import { requireViewer } from "@/lib/server/session";
import { homeFor } from "@/lib/viewer";
import { TotpEnroll } from "./enroll";

export const metadata: Metadata = { title: "Two-factor sign-in" };

export default async function SecurityPage() {
  const viewer = await requireViewer();
  return (
    <main className="grid min-h-dvh place-items-center bg-canvas px-4 py-10">
      <div className="w-full max-w-sm animate-enter">
        <Image src="/4.png" alt="AetherCode" width={36} height={36} className="logo-light mx-auto object-contain" />
        <Image src="/3.png" alt="AetherCode" width={36} height={36} className="logo-dark mx-auto object-contain" />
        <h1 className="display mt-6 text-center text-[2rem] text-ink">Two-factor sign-in</h1>
        <p className="mx-auto mt-2 max-w-[34ch] text-center text-sm text-ink-muted">
          Changing accounts, roles and permissions needs a code from an authenticator app. Add one here once.
        </p>
        <Panel className="mt-8 p-5">
          <TotpEnroll />
        </Panel>
        <p className="mt-6 text-center text-sm">
          <Link href={homeFor(viewer)} className="text-brand hover:underline">Back</Link>
        </p>
      </div>
    </main>
  );
}
