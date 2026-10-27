import type { Metadata } from "next";
import Link from "next/link";
import { SystemCheck } from "./system-check";

export const metadata: Metadata = {
  title: "System check",
  description: "Check your browser, connection and screen are ready for an AetherCode exam.",
  alternates: { canonical: "/system-check" },
};

export default function SystemCheckPage() {
  return (
    <div className="mx-auto max-w-2xl px-6 pb-24 pt-14 sm:pt-20">
      <h1 className="display text-[2.6rem] text-ink sm:text-[3.4rem]">Ready for your exam?</h1>
      <p className="mt-5 max-w-[48ch] text-[16px] leading-relaxed text-ink-muted">
        This checks the laptop and network you&apos;ll use, in about ten seconds. Run it in the lab, on exam day&apos;s Wi-Fi. It never
        asks for your camera or microphone.
      </p>
      <div className="mt-10">
        <SystemCheck />
      </div>
      <p className="mt-8 text-[14px] text-ink-muted">
        Something failing? See the <Link href="/help" className="text-ink underline underline-offset-2">help center</Link> or tell your
        invigilator.
      </p>
    </div>
  );
}
