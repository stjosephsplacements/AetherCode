import type { Metadata } from "next";
import { PageHeader, Section } from "@/components/staff/page-header";
import { requireStaff } from "@/lib/server/staff";
import { FaqList } from "./faq";
import { FlowPlayer } from "./flows";

export const metadata: Metadata = { title: "FAQ and guides" };

export default async function HelpPage() {
  await requireStaff();
  return (
    <>
      <PageHeader title="FAQ and guides" description="How the platform fits together, step by step." />
      <Section title="Walkthroughs" description="Pick a flow. Each step shows the page to use and what to fill in.">
        <FlowPlayer />
      </Section>
      <Section title="Common questions">
        <FaqList />
      </Section>
    </>
  );
}
