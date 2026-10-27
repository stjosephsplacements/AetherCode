import type { Metadata } from "next";
import Link from "next/link";
import { HelpCenter } from "./help-center";

export const metadata: Metadata = {
  title: "Help center",
  description: "Answers about exams, Safe Exam Browser, supported languages and staff tasks on AetherCode.",
  alternates: { canonical: "/help" },
};

export default function PublicHelpPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 pb-24 pt-14 sm:pt-20">
      <h1 className="display text-[2.6rem] text-ink sm:text-[3.4rem]">How can we help?</h1>
      <p className="mt-5 max-w-[50ch] text-[16px] leading-relaxed text-ink-muted">
        Answers to what students and staff ask most. Before an exam, run the <Link href="/system-check" className="text-ink underline underline-offset-2">system check</Link>.
      </p>
      <div className="mt-10">
        <HelpCenter />
      </div>
    </div>
  );
}
