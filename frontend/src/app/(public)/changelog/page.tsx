import type { Metadata } from "next";
import { SITE } from "@/lib/site";
import { ReleaseList } from "./release-list";

export const metadata: Metadata = {
  title: "Changelog",
  description: "What's new in AetherCode: features, compiler updates and security fixes.",
  alternates: { canonical: "/changelog" },
};

export default function ChangelogPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 pb-24 pt-14 sm:pt-20">
      <h1 className="display text-[2.6rem] text-ink sm:text-[3.4rem]">Changelog</h1>
      <p className="mt-5 max-w-[46ch] text-[16px] leading-relaxed text-ink-muted">
        What changed, when. Every change is public on <a href={SITE.repo} className="text-ink underline underline-offset-2">GitHub</a>.
      </p>
      <div className="mt-10">
        <ReleaseList />
      </div>
    </div>
  );
}
