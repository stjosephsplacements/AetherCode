import { Bookmark, BookmarkCheck, ExternalLink } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/staff/page-header";
import { Badge } from "@/components/ui/card";
import type { FeedItem, FeedKind } from "@/lib/api-types";
import { cn, formatWindow } from "@/lib/utils";
import { setBookmark } from "@/app/student/community/actions";

export const FEED_TITLES: Record<FeedKind, { title: string; intro: string; empty: string }> = {
  contest: { title: "Contests", intro: "Coding contests coming up, added by your placement team.", empty: "No contests are listed right now." },
  hackathon: { title: "Hackathons", intro: "Hackathons and events worth a team.", empty: "No hackathons are listed right now." },
  opensource: { title: "Open source", intro: "Beginner-friendly issues and programmes to make your first contribution.", empty: "No open-source listings yet." },
};

const PHASE_TONE = { upcoming: "brand", live: "success", ended: "neutral" } as const;

export function FeedView({ kind, items, path, saved }: { kind: FeedKind; items: FeedItem[]; path: string; saved: boolean }) {
  const { title, intro, empty } = FEED_TITLES[kind];
  return (
    <div className="animate-enter">
      <h1 className="display text-[2.25rem] text-ink sm:text-[2.6rem]">{title}</h1>
      <p className="mt-2 max-w-[60ch] text-[15px] text-ink-muted">{intro}</p>
      <nav aria-label="Filter" className="mt-6 flex gap-1.5">
        {[
          { href: path, label: "Open", active: !saved },
          { href: `${path}?saved=1`, label: "Saved", active: saved },
        ].map((tab) => (
          <Link key={tab.href} href={tab.href} aria-current={tab.active ? "page" : undefined} className={cn("rounded-full px-3 py-1 text-[13px]", tab.active ? "bg-ink text-canvas" : "bg-hover text-ink-muted hover:text-ink")}>
            {tab.label}
          </Link>
        ))}
      </nav>
      <div className="mt-6">
        {items.length === 0 ? (
          <EmptyState>{saved ? "Nothing saved yet." : empty}</EmptyState>
        ) : (
          <ul className="overflow-hidden rounded-[var(--radius-surface)] border border-line bg-surface">
            {items.map((item, index) => (
              <li key={item.id} className={cn("flex items-start gap-4 px-5 py-4", index > 0 && "border-t border-line")}>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <a href={item.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-[15px] font-medium text-ink hover:text-brand">
                      {item.title}
                      <ExternalLink className="size-3.5" strokeWidth={1.75} />
                    </a>
                    <Badge tone={PHASE_TONE[item.phase]}>{item.phase}</Badge>
                    {item.platform && <Badge>{item.platform}</Badge>}
                  </div>
                  {item.starts_at && item.ends_at && <p className="mt-0.5 text-[13px] text-ink-muted">{formatWindow(item.starts_at, item.ends_at)}</p>}
                  {item.starts_at && !item.ends_at && <p className="mt-0.5 text-[13px] text-ink-muted">Starts {formatWindow(item.starts_at, item.starts_at).split(" to ")[0]}</p>}
                  {item.description && <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">{item.description}</p>}
                  {item.tags.length > 0 && <p className="mt-1.5 text-[12px] text-ink-subtle">{item.tags.join(", ")}</p>}
                </div>
                <form action={setBookmark}>
                  <input type="hidden" name="id" value={item.id} />
                  <input type="hidden" name="on" value={String(!item.bookmarked)} />
                  <button type="submit" aria-label={item.bookmarked ? "Remove from saved" : "Save"} className="rounded p-1.5 text-ink-muted transition-colors hover:bg-hover hover:text-ink">
                    {item.bookmarked ? <BookmarkCheck className="size-[18px] text-brand" strokeWidth={1.75} /> : <Bookmark className="size-[18px]" strokeWidth={1.75} />}
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
