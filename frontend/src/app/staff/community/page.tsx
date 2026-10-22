import { Trash2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm, Field, Select, TextArea, TextInput } from "@/components/staff/form";
import { EmptyState, LoadError, PageHeader, Section } from "@/components/staff/page-header";
import { Badge, Panel } from "@/components/ui/card";
import type { CommunityPost, FeedItem, InterviewExperience } from "@/lib/api-types";
import { communityList } from "@/lib/server/community";
import { requireCollege } from "@/lib/server/staff";
import { cn, formatDateTime, isoToCollegeTime } from "@/lib/utils";
import { ExperienceCard } from "@/app/student/(shell)/interviews/experience-card";
import { deleteListing, deletePost, importContests, importIssues, reviewExperience, saveListing, savePost } from "./actions";

export const metadata: Metadata = { title: "Community" };

const TABS = [
  { id: "interviews", label: "Interview experiences" },
  { id: "blogs", label: "Blogs" },
  { id: "listings", label: "Contests, hackathons and open source" },
] as const;

export default async function CommunityPage({ searchParams }: { searchParams: Promise<{ tab?: string; edit?: string }> }) {
  const staff = await requireCollege();
  const { tab: requested, edit } = await searchParams;
  const tab = TABS.find((candidate) => candidate.id === requested)?.id ?? "interviews";
  return (
    <>
      <PageHeader title="Community" description="What students read beyond exams: approve interview experiences, write blogs and keep the contest, hackathon and open-source lists current." />
      <nav aria-label="Community sections" className="mb-6 flex flex-wrap gap-1.5">
        {TABS.map((item) => (
          <Link key={item.id} href={`/staff/community?tab=${item.id}`} aria-current={item.id === tab ? "page" : undefined} className={cn("rounded-full px-3 py-1 text-[13px]", item.id === tab ? "bg-ink text-canvas" : "bg-hover text-ink-muted hover:text-ink")}>
            {item.label}
          </Link>
        ))}
      </nav>
      {tab === "interviews" && <Interviews tenantId={staff.tenantId} />}
      {tab === "blogs" && <Blogs tenantId={staff.tenantId} edit={edit} />}
      {tab === "listings" && <Listings tenantId={staff.tenantId} edit={edit} />}
    </>
  );
}

async function Interviews({ tenantId }: { tenantId: string }) {
  let queue: InterviewExperience[];
  try {
    queue = await communityList<InterviewExperience>(tenantId, "moderation/interview-experiences");
  } catch (error) {
    return <LoadError error={error} />;
  }
  if (queue.length === 0) return <EmptyState>Nothing is waiting for approval.</EmptyState>;
  return (
    <div className="space-y-5">
      {queue.map((experience) => (
        <div key={experience.id}>
          <ExperienceCard experience={{ ...experience, mine: false }} />
          <form action={reviewExperience} className="mt-2 flex flex-wrap items-center gap-2">
            <input type="hidden" name="id" value={experience.id} />
            <TextInput name="note" placeholder="Note to the author (optional)" maxLength={500} className="max-w-[360px]" aria-label="Note to the author" />
            <button type="submit" name="approve" value="true" className="rounded-[var(--radius-control)] bg-brand px-3 py-1.5 text-sm text-brand-ink hover:bg-brand-hover">
              Approve
            </button>
            <button type="submit" name="approve" value="false" className="rounded-[var(--radius-control)] bg-hover px-3 py-1.5 text-sm text-ink hover:bg-line">
              Send back
            </button>
          </form>
        </div>
      ))}
    </div>
  );
}

async function Blogs({ tenantId, edit }: { tenantId: string; edit?: string }) {
  let posts: CommunityPost[];
  try {
    posts = await communityList<CommunityPost>(tenantId, "moderation/posts");
  } catch (error) {
    return <LoadError error={error} />;
  }
  const editing = posts.find((post) => post.id === edit);
  return (
    <>
      {posts.length === 0 ? (
        <EmptyState>No posts yet.</EmptyState>
      ) : (
        <ul className="overflow-hidden rounded-[var(--radius-surface)] border border-line bg-surface">
          {posts.map((post, index) => (
            <li key={post.id} className={cn("flex items-center gap-4 px-5 py-3", index > 0 && "border-t border-line")}>
              <div className="min-w-0 flex-1">
                <Link href={`/staff/community?tab=blogs&edit=${post.id}`} className="truncate text-[15px] font-medium text-ink hover:text-brand">
                  {post.title}
                </Link>
                <p className="text-[12px] text-ink-subtle">{post.status === "published" && post.published_at ? `Published ${formatDateTime(post.published_at)}` : `Draft, saved ${formatDateTime(post.updated_at)}`}</p>
              </div>
              <Badge tone={post.status === "published" ? "success" : "neutral"}>{post.status === "published" ? "Published" : "Draft"}</Badge>
              <form action={deletePost}>
                <input type="hidden" name="id" value={post.id} />
                <button type="submit" aria-label={`Delete ${post.title}`} className="text-ink-subtle hover:text-danger">
                  <Trash2 className="size-4" strokeWidth={1.75} />
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
      <Section title={editing ? "Edit post" : "New post"} description="Markdown. Students see it once it is published.">
        <Panel className="p-5">
          <ActionForm key={editing?.id ?? "new"} action={savePost} submitLabel="Save post">
            {editing && <input type="hidden" name="id" value={editing.id} />}
            <Field label="Title" htmlFor="post-title">
              <TextInput id="post-title" name="title" defaultValue={editing?.title} maxLength={200} required />
            </Field>
            <Field label="Body" htmlFor="post-body">
              <TextArea id="post-body" name="body_markdown" rows={12} defaultValue={editing?.body_markdown} maxLength={50000} required />
            </Field>
            <Field label="Tags" hint="Separated by commas" htmlFor="post-tags">
              <TextInput id="post-tags" name="tags" defaultValue={editing?.tags.join(", ")} />
            </Field>
            <label className="flex items-center gap-2 text-sm text-ink">
              <input type="checkbox" name="publish" defaultChecked={editing?.status === "published"} />
              Published
            </label>
          </ActionForm>
          {editing && (
            <Link href="/staff/community?tab=blogs" className="mt-3 inline-block text-sm text-ink-muted hover:text-ink">
              Start a new post instead
            </Link>
          )}
        </Panel>
      </Section>
    </>
  );
}

async function Listings({ tenantId, edit }: { tenantId: string; edit?: string }) {
  let items: FeedItem[];
  try {
    items = await communityList<FeedItem>(tenantId, "feed", { limit: 100 });
  } catch (error) {
    return <LoadError error={error} />;
  }
  const editing = items.find((item) => item.id === edit);
  return (
    <>
      <Section title="Fill from the web" description="Codeforces' public contest list and GitHub issues labelled “good first issue”. Run again any time; listings update, they do not duplicate.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Panel className="p-4">
            <ActionForm action={importContests} submitLabel="Import upcoming Codeforces contests">
              <p className="text-sm text-ink-muted">Adds the next contests as contest listings.</p>
            </ActionForm>
          </Panel>
          <Panel className="p-4">
            <ActionForm action={importIssues} submitLabel="Import good first issues">
              <p className="text-sm text-ink-muted">Adds recently updated beginner issues as open-source listings.</p>
            </ActionForm>
          </Panel>
        </div>
      </Section>

      <Section title="Listings">
        {items.length === 0 ? (
          <EmptyState>No listings yet.</EmptyState>
        ) : (
          <ul className="overflow-hidden rounded-[var(--radius-surface)] border border-line bg-surface">
            {items.map((item, index) => (
              <li key={item.id} className={cn("flex items-center gap-4 px-5 py-3", index > 0 && "border-t border-line")}>
                <div className="min-w-0 flex-1">
                  <Link href={`/staff/community?tab=listings&edit=${item.id}`} className="truncate text-[15px] font-medium text-ink hover:text-brand">
                    {item.title}
                  </Link>
                  <p className="truncate text-[12px] text-ink-subtle">{[item.platform, item.starts_at && formatDateTime(item.starts_at)].filter(Boolean).join(" · ")}</p>
                </div>
                <Badge>{item.kind === "opensource" ? "Open source" : item.kind === "contest" ? "Contest" : "Hackathon"}</Badge>
                <form action={deleteListing}>
                  <input type="hidden" name="id" value={item.id} />
                  <button type="submit" aria-label={`Delete ${item.title}`} className="text-ink-subtle hover:text-danger">
                    <Trash2 className="size-4" strokeWidth={1.75} />
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={editing ? "Edit listing" : "Add a listing"}>
        <Panel className="p-5">
          <ActionForm key={editing?.id ?? "new"} action={saveListing} submitLabel="Save listing">
            {editing && <input type="hidden" name="id" value={editing.id} />}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Type" htmlFor="listing-kind">
                <Select id="listing-kind" name="kind" defaultValue={editing?.kind ?? "contest"}>
                  <option value="contest">Contest</option>
                  <option value="hackathon">Hackathon</option>
                  <option value="opensource">Open source</option>
                </Select>
              </Field>
              <Field label="Platform" htmlFor="listing-platform">
                <TextInput id="listing-platform" name="platform" defaultValue={editing?.platform ?? ""} maxLength={100} placeholder="Codeforces, Devfolio, GitHub" />
              </Field>
              <Field label="Title" htmlFor="listing-title" className="sm:col-span-2">
                <TextInput id="listing-title" name="title" defaultValue={editing?.title} maxLength={300} required />
              </Field>
              <Field label="Link" htmlFor="listing-url" className="sm:col-span-2">
                <TextInput id="listing-url" name="url" type="url" defaultValue={editing?.url} placeholder="https://" required />
              </Field>
              <Field label="Starts (optional)" htmlFor="listing-starts">
                <TextInput id="listing-starts" name="starts_at" type="datetime-local" defaultValue={editing?.starts_at ? isoToCollegeTime(editing.starts_at) : ""} />
              </Field>
              <Field label="Ends (optional)" htmlFor="listing-ends">
                <TextInput id="listing-ends" name="ends_at" type="datetime-local" defaultValue={editing?.ends_at ? isoToCollegeTime(editing.ends_at) : ""} />
              </Field>
              <Field label="Description (optional)" htmlFor="listing-description" className="sm:col-span-2">
                <TextArea id="listing-description" name="description" rows={3} defaultValue={editing?.description ?? ""} maxLength={4000} />
              </Field>
              <Field label="Tags" hint="Separated by commas" htmlFor="listing-tags" className="sm:col-span-2">
                <TextInput id="listing-tags" name="tags" defaultValue={editing?.tags.join(", ")} />
              </Field>
            </div>
          </ActionForm>
          {editing && (
            <Link href="/staff/community?tab=listings" className="mt-3 inline-block text-sm text-ink-muted hover:text-ink">
              Add a new listing instead
            </Link>
          )}
        </Panel>
      </Section>
    </>
  );
}
