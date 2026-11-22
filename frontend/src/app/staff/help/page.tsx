import type { Metadata } from "next";
import { panel } from "@/app/admin/_dashboard/panel";
import { PageHeader } from "@/components/staff/page-header";
import { requireStaff } from "@/lib/server/staff";
import { cn } from "@/lib/utils";
import { FaqList } from "./faq";
import { FlowPlayer } from "./flows";

export const metadata: Metadata = { title: "FAQ and guides" };

export default async function HelpPage() {
  await requireStaff();
  return (
    <div className="animate-enter">
      <PageHeader title="FAQ and guides" description="Common questions and step-by-step guides." />

      <div className="grid gap-3 xl:grid-cols-12">
        <section className={cn(panel, "xl:col-span-7")}>
          <div className="mb-4">
            <h2 className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-subtle">Walkthroughs</h2>
            <p className="mt-1 text-[12.5px] text-ink-muted">Pick a flow. Each step shows the page to use and what to fill in.</p>
          </div>
          <FlowPlayer />
        </section>
        <section className={cn(panel, "xl:col-span-5")}>
          <div className="mb-4">
            <h2 className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-subtle">Common questions</h2>
            <p className="mt-1 text-[12.5px] text-ink-muted">Short answers for the things staff ask most.</p>
          </div>
          <FaqList />
        </section>
      </div>
    </div>
  );
}
