import { Download, GraduationCap, Mail, Trophy, User, ExternalLink, Code } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Panel } from "@/components/ui/card";
import type { ProfileLink, PracticeProgress } from "@/lib/api-types";
import { brandFor } from "@/lib/server/branding";
import { communityList } from "@/lib/server/community";
import { platformStats } from "@/lib/server/platforms";
import { gateway } from "@/lib/server/gateway";
import { requireViewer } from "@/lib/server/session";
import { PrintButton } from "./print-button";

export const metadata: Metadata = { title: "My resume" };

export default async function ResumePage() {
  const viewer = await requireViewer();
  if (!viewer.tenantId) redirect("/student");

  const [links, progress, brand] = await Promise.all([
    communityList<ProfileLink>(viewer.tenantId, "profile-links").catch(() => []),
    gateway<PracticeProgress>(`/question-bank/v1/tenants/${viewer.tenantId}/practice/progress`).catch(() => null),
    brandFor(viewer.tenantId),
  ]);

  const institutionName = brand.name || "Engineering Institute";
  const stats = await platformStats(links);

  return (
    <div className="animate-enter max-w-4xl space-y-6 pb-12">
      {/* Top Header / Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-line pb-4 print:hidden">
        <div>
          <span className="text-xs font-semibold tracking-wider uppercase text-brand">Placement Resume Profile</span>
          <h1 className="display text-3xl font-bold text-ink sm:text-4xl">Student Resume</h1>
        </div>
        <PrintButton />
      </div>

      {/* Printable Sheet */}
      <div className="rounded-[var(--radius-card)] border border-line bg-surface p-6 sm:p-8 space-y-8 shadow-sm print:border-none print:shadow-none print:p-0">
        {/* Identity Section */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6 border-b border-line pb-6">
          <div className="space-y-1.5">
            <h2 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">{viewer.displayName || "Student"}</h2>
            <p className="text-sm font-medium text-brand">{institutionName}</p>
            <div className="flex flex-wrap items-center gap-4 pt-1 text-xs text-ink-muted">
              <span className="inline-flex items-center gap-1.5 font-mono">
                <User className="size-3.5" />
                {viewer.username || "Student ID"}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <GraduationCap className="size-3.5" />
                Enrolled Student
              </span>
            </div>
          </div>

          {/* Quick Metrics */}
          <div className="flex items-center gap-4 rounded-[var(--radius-control)] bg-canvas/60 p-3 sm:gap-6 border border-line">
            <div className="text-center">
              <p className="text-2xl font-bold text-brand">{progress?.solved ?? 0}</p>
              <p className="text-[10px] uppercase font-bold tracking-wider text-ink-muted">Aether Solved</p>
            </div>
            <div className="h-8 w-px bg-line" />
            <div className="text-center">
              <p className="text-2xl font-bold text-ink">{stats.length}</p>
              <p className="text-[10px] uppercase font-bold tracking-wider text-ink-muted">Profiles Linked</p>
            </div>
          </div>
        </div>

        {/* Competitive Profiles */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Code className="size-4 text-brand" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-ink">Competitive Programming & Coding Profiles</h3>
          </div>
          {stats.length === 0 ? (
            <p className="text-sm text-ink-muted italic">No external coding profiles linked yet. Add handles in your profile.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {stats.map((stat) => (
                <Panel key={stat.platform} className="p-3.5 bg-canvas/30">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-sm capitalize text-ink">{stat.platform}</span>
                    <a href={stat.url} target="_blank" rel="noopener noreferrer" className="text-xs text-brand hover:underline inline-flex items-center gap-1">
                      {stat.handle}
                      <ExternalLink className="size-3" />
                    </a>
                  </div>
                  {stat.lines && stat.lines.length > 0 ? (
                    <ul className="mt-2 space-y-0.5 text-xs text-ink-muted">
                      {stat.lines.map((l) => (
                        <li key={l}>{l}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 text-xs text-ink-muted">Profile verified & linked</p>
                  )}
                </Panel>
              ))}
            </div>
          )}
        </div>

        {/* Education & Academic Profile */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <GraduationCap className="size-4 text-brand" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-ink">Education & Academics</h3>
          </div>
          <div className="rounded-[var(--radius-control)] border border-line p-4 space-y-2 bg-canvas/20">
            <div className="flex items-center justify-between font-medium text-sm text-ink">
              <span>B.E. Computer Science and Engineering</span>
              <span className="text-ink-muted font-mono text-xs">Undergraduate</span>
            </div>
            <p className="text-xs text-ink-muted">{institutionName}</p>
          </div>
        </div>

        {/* Technical Competencies */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Trophy className="size-4 text-brand" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-ink">Skills & Core Strengths</h3>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs text-ink-muted">
            <div className="border border-line rounded-lg p-3">
              <span className="font-semibold text-ink block mb-1">Languages</span>
              Python, C++, Java, TypeScript, SQL
            </div>
            <div className="border border-line rounded-lg p-3">
              <span className="font-semibold text-ink block mb-1">Core Fundamentals</span>
              Data Structures, Algorithms, OOP, DBMS, OS
            </div>
            <div className="border border-line rounded-lg p-3">
              <span className="font-semibold text-ink block mb-1">Platforms</span>
              Linux, Docker, Git & GitHub, Kubernetes
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
