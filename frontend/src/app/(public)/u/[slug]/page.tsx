import { ExternalLink } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { publicProfile } from "@/lib/server/public-profile";
import { lettermark } from "@/app/staff/placements/stats";

// Always live: hiding a profile must take effect at once.
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const profile = await publicProfile((await params).slug);
  if (!profile) return { title: "Profile not found", robots: { index: false } };
  const { name, headline, college } = profile.content;
  return {
    title: `${name} on AetherCode`,
    description: [headline, college].filter(Boolean).join(" · ") || `${name}'s coding profile on AetherCode.`,
    // A student shares this link on purpose; search engines are not asked to list it.
    robots: { index: false, follow: false },
  };
}

export default async function PublicProfilePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const profile = await publicProfile(slug);
  if (!profile) notFound();
  const { name, headline, bio, college, batch, skills = [], links = [] } = profile.content;

  return (
    <div className="mx-auto max-w-3xl px-6 pb-24 pt-14 sm:pt-20">
      <article className="rounded-[var(--radius-surface)] overflow-hidden border border-line-strong bg-surface shadow-[var(--shadow-panel)]">
        <header className="flex flex-wrap items-center gap-5 border-b border-line-strong p-6 sm:p-8">
          <span aria-hidden className="grid size-20 shrink-0 place-items-center bg-brand font-mono text-[26px] font-semibold text-brand-ink">
            {lettermark(name)}
          </span>
          <div className="min-w-0">
            <p className="font-mono text-[12px] text-ink-subtle">{"// @"}{profile.slug}</p>
            <h1 className="mt-1 text-[2rem] font-semibold leading-tight tracking-[-0.02em] text-ink sm:text-[2.6rem]">{name}</h1>
            {headline && <p className="mt-1.5 text-[15px] text-ink-muted">{headline}</p>}
            {(college || batch) && <p className="mt-2 font-mono text-[12.5px] text-ink-muted">{[college, batch].filter(Boolean).join(" · ")}</p>}
          </div>
        </header>

        {bio && (
          <section aria-label="About" className="border-b border-line p-6 sm:p-8">
            <h2 className="mb-2 font-mono text-[13px] text-ink-muted">About</h2>
            <p className="whitespace-pre-line text-[15px] leading-[1.7] text-ink">{bio}</p>
          </section>
        )}

        {skills.length > 0 && (
          <section aria-label="Skills" className="border-b border-line p-6 sm:p-8">
            <h2 className="mb-3 font-mono text-[13px] text-ink-muted">Skills</h2>
            <ul className="flex flex-wrap gap-2">
              {skills.map((skill) => (
                <li key={skill} className="rounded-full border border-line-strong bg-canvas px-3 py-1 font-mono text-[12.5px] text-ink">
                  {skill}
                </li>
              ))}
            </ul>
          </section>
        )}

        {links.length > 0 && (
          <section aria-label="Coding profiles" className="p-6 sm:p-8">
            <h2 className="mb-3 font-mono text-[13px] text-ink-muted">Coding profiles</h2>
            <ul className="grid gap-3 sm:grid-cols-2">
              {links.map((link) => (
                <li key={link.platform}>
                  {link.url ? (
                    <a href={link.url} target="_blank" rel="noopener noreferrer nofollow" className="flex items-center justify-between border border-line-strong bg-canvas px-4 py-3 transition-colors hover:bg-brand hover:text-brand-ink">
                      <span>
                        <span className="block text-[14px] font-medium">{link.platform}</span>
                        <span className="block font-mono text-[12px] opacity-70">{link.handle}</span>
                      </span>
                      <ExternalLink className="size-4" strokeWidth={1.75} />
                    </a>
                  ) : (
                    <div className="rounded-full border border-line-strong bg-canvas px-4 py-3">
                      <span className="block text-[14px] font-medium">{link.platform}</span>
                      <span className="block font-mono text-[12px] text-ink-muted">{link.handle}</span>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
      </article>
      <p className="mt-6 font-mono text-[12px] text-ink-subtle">{"// shared by the student on AetherCode. only what they chose to show is here."}</p>
    </div>
  );
}
