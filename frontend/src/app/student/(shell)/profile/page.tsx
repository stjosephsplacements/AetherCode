import { ExternalLink } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ActionForm, Field, TextInput } from "@/components/staff/form";
import { Section, PageHeader } from "@/components/staff/page-header";
import { Panel } from "@/components/ui/card";
import type { PlatformName, ProfileLink } from "@/lib/api-types";
import { communityList } from "@/lib/server/community";
import { platformStats } from "@/lib/server/platforms";
import { requireViewer } from "@/lib/server/session";
import { publicOrigin } from "@/lib/server/config";
import { ownPublicProfile } from "@/lib/server/public-profile";
import { saveProfileLink } from "../../community/actions";
import { PublicProfileForm } from "./public-profile-form";

export const metadata: Metadata = { title: "My profile" };

const PLATFORMS: { name: PlatformName; label: string; hint: string }[] = [
  { name: "leetcode", label: "LeetCode", hint: "Your username, from leetcode.com/u/…" },
  { name: "codeforces", label: "Codeforces", hint: "Your handle" },
  { name: "github", label: "GitHub", hint: "Your username" },
  { name: "codechef", label: "CodeChef", hint: "Your username. Shown as a link only." },
  { name: "hackerrank", label: "HackerRank", hint: "Your username. Shown as a link only." },
  { name: "atcoder", label: "AtCoder", hint: "Your username." },
  { name: "skillrack", label: "SkillRack", hint: "Your profile ID." },
];

export default async function ProfilePage() {
  const viewer = await requireViewer();
  if (!viewer.tenantId) redirect("/student");
  const [links, publicProfile] = await Promise.all([communityList<ProfileLink>(viewer.tenantId, "profile-links"), ownPublicProfile(viewer.principalId, viewer.tenantId).catch(() => null)]);
  const stats = await platformStats(links);
  const handleOf = (platform: PlatformName) => links.find((link) => link.platform === platform)?.handle ?? "";
  return (
    <div className="animate-enter">
      <PageHeader title={viewer.displayName || "My profile"} description={"Link your coding accounts to see your public numbers in one place. Numbers refresh hourly and come from each site; if one is down it shows only the link."} />

      {publicProfile && (
        <div className="mt-8">
          <PublicProfileForm profile={publicProfile} origin={publicOrigin()} suggestion={viewer.username.replace(/[^a-z0-9-]/g, "-")} />
        </div>
      )}

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        {stats.length === 0 && <p className="text-sm text-ink-muted sm:col-span-2">No accounts linked yet.</p>}
        {stats.map((stat) => (
          <Panel key={stat.platform} className="p-5">
            <a href={stat.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-[15px] font-semibold text-ink hover:text-brand">
              {PLATFORMS.find((platform) => platform.name === stat.platform)?.label}
              <ExternalLink className="size-3.5" strokeWidth={1.75} />
            </a>
            <p className="text-[13px] text-ink-muted">{stat.handle}</p>
            {stat.lines ? (
              <ul className="mt-3 space-y-0.5 text-sm text-ink">
                {stat.lines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-ink-muted">No numbers to show.</p>
            )}
          </Panel>
        ))}
      </div>

      <Section title="Linked accounts" description="Leave a field empty and save to unlink it.">
        <div className="grid gap-4 sm:grid-cols-2">
          {PLATFORMS.map((platform) => (
            <Panel key={platform.name} className="p-4">
              <ActionForm action={saveProfileLink} submitLabel="Save">
                <input type="hidden" name="platform" value={platform.name} />
                <Field label={platform.label} hint={platform.hint} htmlFor={`handle-${platform.name}`}>
                  <TextInput id={`handle-${platform.name}`} name="handle" defaultValue={handleOf(platform.name)} maxLength={60} />
                </Field>
              </ActionForm>
            </Panel>
          ))}
        </div>
      </Section>
    </div>
  );
}
