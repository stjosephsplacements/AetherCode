import { ArrowSquareOut, CaretRight, Checks, Trash } from "@phosphor-icons/react/ssr";
import { Pager } from "@/components/staff/pager";
import { paginate } from "@/lib/paginate";
import Link from "next/link";
import { ConfirmDelete } from "@/components/staff/confirm-delete";
import { ActionForm, TextInput } from "@/components/staff/form";
import { EmptyState, PageHeader } from "@/components/staff/page-header";
import { Tile } from "@/components/staff/tile";
import { Badge } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import type { CommunityPost, FeedItem, FeedKind, InterviewExperience } from "@/lib/api-types";
import { cn, formatDateTime } from "@/lib/utils";
import { ExperienceCard } from "@/app/student/(shell)/interviews/experience-card";
import { importContests, importIssues, removeListing, removePost, reviewExperience } from "./actions";
import { ListingDialog, PostDialog } from "./editors";

const TABS = [
  { id: "interviews", label: "Interview experiences" },
  { id: "blogs", label: "Blogs" },
  { id: "listings", label: "Contests and open source" },
] as const;

const KINDS: { id: FeedKind; label: string }[] = [
  { id: "contest", label: "Contests" },
  { id: "hackathon", label: "Hackathons" },
  { id: "opensource", label: "Open source" },
];
const KIND_LABEL: Record<FeedKind, string> = { contest: "Contest", hackathon: "Hackathon", opensource: "Open source" };
const PHASE: Record<FeedItem["phase"], { label: string; tone: "success" | "brand" | "neutral" }> = {
  live: { label: "Live", tone: "success" },
  upcoming: { label: "Upcoming", tone: "brand" },
  ended: { label: "Ended", tone: "neutral" },
};
const VERDICT = { selected: ["Selected", "success"], rejected: ["Not selected", "danger"], waitlisted: ["Waitlisted", "warning"] } as const;

export type College = { id: string; name: string };
type Tagged<T> = { row: T; college: College };

export type CommunityViewProps = {
  tab: (typeof TABS)[number]["id"];
  kind?: FeedKind;
  page?: string;
  several: boolean;
  /** Every college, for a root administrator: the filter and the pickers in the forms. */
  /** The one college being looked at, when a root administrator has narrowed to one. */
  queue: Tagged<InterviewExperience>[];
  posts: Tagged<CommunityPost>[];
  items: Tagged<FeedItem>[];
  unreachable: string[];
};

/** Everything the Community page shows, from rows already loaded; no loading happens here. */
export function CommunityView({ tab, kind, page, several, queue, posts, items, unreachable }: CommunityViewProps) {
  const href = (next: Record<string, string | undefined>) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries({ tab, ...next })) if (value) query.set(key, value);
    return `/staff/community?${query.toString()}`;
  };

  const published = posts.filter(({ row }) => row.status === "published").length;
  const counting = items.filter(({ row }) => row.phase !== "ended").length;
  const shownItems = items.filter(({ row }) => !kind || row.kind === kind);
  const pagedQueue = paginate(queue, page);
  const pagedPosts = paginate(posts, page);
  const pagedItems = paginate(shownItems, page);
  const counts: Record<(typeof TABS)[number]["id"], number> = { interviews: queue.length, blogs: posts.length, listings: items.length };

  return (
    <>
      <PageHeader
        title="Community"
        description="Review interview posts, write blogs and manage contest/hackathon listings."
        actions={
          <>
            {tab === "blogs" && <PostDialog />}
            {tab === "listings" && <ListingDialog />}
          </>
        }
      />
      {unreachable.length > 0 && <p role="alert" className="mb-4 text-sm text-warning">Could not load: {unreachable.join(", ")}.</p>}

      <section aria-label="At a glance" className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Waiting for review" live={queue.length > 0}>
          <p className={cn("mt-auto text-[30px] font-semibold leading-none tracking-[-0.03em] tabular-nums", queue.length > 0 ? "text-brand" : "text-ink")}>{queue.length}</p>
          <p className="mt-2 text-[12.5px] text-ink-muted">{queue.length === 0 ? "interview experiences, all caught up" : "interview experiences from students"}</p>
        </Tile>
        <Tile label="Published posts">
          <p className="mt-auto text-[30px] font-semibold leading-none tracking-[-0.03em] tabular-nums text-ink">{published}</p>
          <p className="mt-2 text-[12.5px] text-ink-muted">{posts.length - published} in draft</p>
        </Tile>
        <Tile label="Open listings">
          <p className="mt-auto text-[30px] font-semibold leading-none tracking-[-0.03em] tabular-nums text-ink">{counting}</p>
          <p className="mt-2 text-[12.5px] text-ink-muted">live or coming up</p>
        </Tile>
        <Tile label="Past listings">
          <p className="mt-auto text-[30px] font-semibold leading-none tracking-[-0.03em] tabular-nums text-ink">{items.length - counting}</p>
          <p className="mt-2 text-[12.5px] text-ink-muted">already ended</p>
        </Tile>
      </section>

      <nav aria-label="Community sections" className="mb-5 inline-flex flex-wrap rounded-[var(--radius-control)] border border-line p-0.5 text-[13.5px]">
        {TABS.map((item) => (
          <Link
            key={item.id}
            href={href({ tab: item.id, kind: undefined })}
            aria-current={item.id === tab ? "page" : undefined}
            className={cn("flex items-center gap-2 rounded-[calc(var(--radius-control)-2px)] px-4 py-1.5 transition-colors", item.id === tab ? "bg-hover font-medium text-ink" : "text-ink-muted hover:text-ink")}
          >
            {item.label}
            {counts[item.id] > 0 && (
              <span className={cn("rounded-full px-1.5 font-mono text-[11px] tabular-nums", item.id === "interviews" ? "bg-brand text-brand-ink" : "bg-hover text-ink-muted")}>{counts[item.id]}</span>
            )}
          </Link>
        ))}
      </nav>

      {tab === "interviews" &&
        (queue.length === 0 ? (
          <div className="grid place-items-center gap-2 rounded-[var(--radius-surface)] border border-dashed border-line-strong px-6 py-16 text-center">
            <Checks aria-hidden className="size-6 text-success" />
            <p className="text-[15px] font-medium text-ink">Nothing is waiting for approval</p>
            <p className="text-sm text-ink-muted">New interview experiences from students show up here to approve or send back.</p>
          </div>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-surface)] border border-line bg-surface">
            {pagedQueue.rows.map(({ row: experience, college }) => {
              const [verdict, tone] = VERDICT[experience.verdict];
              const meta = [experience.experience_level, experience.drive_type, experience.year_of_interview, experience.package_offered].filter(Boolean).join(" · ");
              return (
                <li key={experience.id}>
                  <Dialog>
                    <DialogTrigger className="group flex w-full items-center gap-4 px-5 py-3.5 text-left transition-colors hover:bg-hover">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14.5px] font-medium text-ink">
                          {experience.company}, {experience.role}
                        </span>
                        <span className="mt-0.5 block truncate text-[12.5px] text-ink-muted">
                          {[several ? college.name : "", meta, formatDateTime(experience.created_at)].filter(Boolean).join(" · ")}
                        </span>
                      </span>
                      <Badge tone={tone}>{verdict}</Badge>
                      <span className="hidden text-[12.5px] text-ink-subtle sm:block">{experience.rounds.length} round{experience.rounds.length === 1 ? "" : "s"}</span>
                      <CaretRight aria-hidden className="size-4 shrink-0 text-ink-subtle transition-transform group-hover:translate-x-0.5" />
                    </DialogTrigger>
                    <DialogContent title={`${experience.company}, ${experience.role}`} description={meta || "Interview experience"} className="w-[min(94vw,760px)]">
                      <div className="min-h-0 space-y-5 overflow-y-auto p-6">
                        <ExperienceCard experience={{ ...experience, mine: false }} />
                        <form action={reviewExperience} className="flex flex-wrap items-center gap-2 border-t border-line pt-5">
                          <input type="hidden" name="id" value={experience.id} />
                          <input type="hidden" name="college_id" value={college.id} />
                          <TextInput name="note" placeholder="Note to the author (optional)" maxLength={500} className="max-w-[360px]" aria-label="Note to the author" />
                          <button type="submit" name="approve" value="true" className="h-10 rounded-[var(--radius-control)] bg-brand px-4 text-sm font-medium text-brand-ink transition-colors hover:bg-brand-hover">
                            Approve
                          </button>
                          <button type="submit" name="approve" value="false" className="h-10 rounded-[var(--radius-control)] bg-hover px-4 text-sm text-ink transition-colors hover:bg-line">
                            Send back
                          </button>
                        </form>
                      </div>
                    </DialogContent>
                  </Dialog>
                </li>
              );
            })}
          </ul>
        ))}
      {tab === "interviews" && <Pager meta={pagedQueue} noun="submissions" />}

      {tab === "blogs" &&
        (posts.length === 0 ? (
          <EmptyState>No posts yet. Write one with New post.</EmptyState>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-surface)] border border-line bg-surface">
            {pagedPosts.rows.map(({ row: post, college }) => (
              <li key={post.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14.5px] font-medium text-ink">{post.title}</p>
                  <p className="mt-0.5 truncate text-[12.5px] text-ink-muted">
                    {[several ? college.name : "", post.status === "published" && post.published_at ? `Published ${formatDateTime(post.published_at)}` : `Draft, saved ${formatDateTime(post.updated_at)}`].filter(Boolean).join(" · ")}
                  </p>
                </div>
                {post.tags.length > 0 && (
                  <ul className="hidden flex-wrap gap-1.5 md:flex" aria-label="Tags">
                    {post.tags.slice(0, 3).map((entry) => (
                      <li key={entry} className="rounded-full bg-hover px-2.5 py-0.5 text-[12px] text-ink-muted">
                        {entry}
                      </li>
                    ))}
                  </ul>
                )}
                <Badge tone={post.status === "published" ? "success" : "neutral"}>{post.status === "published" ? "Published" : "Draft"}</Badge>
                <div className="flex items-center gap-1">
                  <PostDialog post={post} college={college.id} />
                  <ConfirmDelete
                    askReason={false}
                    trigger={
                      <Button type="button" variant="ghost" size="sm" aria-label={`Delete ${post.title}`} className="text-ink-subtle hover:bg-danger-soft hover:text-danger">
                        <Trash />
                      </Button>
                    }
                    title={`Delete ${post.title}?`}
                    description="Students can no longer read it. This cannot be undone."
                    onConfirm={async () => {
                      "use server";
                      return removePost(college.id, post.id);
                    }}
                  />
                </div>
              </li>
            ))}
          </ul>
        ))}
      {tab === "blogs" && <Pager meta={pagedPosts} noun="posts" />}

      {tab === "listings" && (
        <div className="space-y-4">
          <section aria-label="Fill from the web" className="grid gap-3 sm:grid-cols-2">
            {[
              { action: importContests, title: "Upcoming Codeforces contests", button: "Import contests", note: "Adds the next contests as contest listings." },
              { action: importIssues, title: "GitHub “good first issue”s", button: "Import issues", note: "Adds recently updated beginner issues as open-source listings." },
            ].map((source) => (
              <Tile key={source.title} label={source.title}>
                <p className="mb-3 text-[13px] text-ink-muted">{source.note} Run again any time; listings update, they do not duplicate.</p>
                <ActionForm action={source.action} submitLabel={source.button} submitVariant="secondary" className="mt-auto">
                {null}
                </ActionForm>
              </Tile>
            ))}
          </section>

          <div role="group" aria-label="Type" className="flex flex-wrap gap-1.5">
            {[{ id: undefined, label: "All" }, ...KINDS].map((entry) => (
              <Link
                key={entry.id ?? "all"}
                href={href({ kind: entry.id })}
                aria-current={kind === entry.id ? "page" : undefined}
                className={cn("rounded-full px-3 py-1 text-[13px] transition-colors", kind === entry.id ? "bg-ink text-canvas" : "bg-hover text-ink-muted hover:text-ink")}
              >
                {entry.label}
                <span className="ml-1.5 font-mono text-[11px] opacity-70">{entry.id ? items.filter(({ row }) => row.kind === entry.id).length : items.length}</span>
              </Link>
            ))}
          </div>

          {shownItems.length === 0 ? (
            <EmptyState>No listings here yet. Add one, or fill from the web above.</EmptyState>
          ) : (
            <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-surface)] border border-line bg-surface">
              {pagedItems.rows.map(({ row: item, college }) => {
                const phase = PHASE[item.phase];
                return (
                  <li key={item.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5">
                    <div className="min-w-0 flex-1">
                      <a href={item.url} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-full items-center gap-1.5 text-[14.5px] font-medium text-ink transition-colors hover:text-brand">
                        <span className="truncate">{item.title}</span>
                        <ArrowSquareOut aria-hidden className="size-3.5 shrink-0 text-ink-subtle" />
                      </a>
                      <p className="mt-0.5 truncate text-[12.5px] text-ink-muted">
                        {[several ? college.name : "", item.platform, item.starts_at && formatDateTime(item.starts_at)].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                    <Badge>{KIND_LABEL[item.kind]}</Badge>
                    <Badge tone={phase.tone}>{phase.label}</Badge>
                    <div className="flex items-center gap-1">
                      <ListingDialog item={item} college={college.id} />
                      <ConfirmDelete
                        askReason={false}
                        trigger={
                          <Button type="button" variant="ghost" size="sm" aria-label={`Delete ${item.title}`} className="text-ink-subtle hover:bg-danger-soft hover:text-danger">
                            <Trash />
                          </Button>
                        }
                        title={`Delete ${item.title}?`}
                        description="Students no longer see it. Importing again can bring it back if it is still listed at the source."
                        onConfirm={async () => {
                          "use server";
                          return removeListing(college.id, item.id);
                        }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
      {tab === "listings" && <Pager meta={pagedItems} noun="listings" />}
    </>
  );
}
