import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { RoundsEditor } from "@/components/community/rounds-editor";
import { ActionForm, Field, Select, TextArea, TextInput } from "@/components/staff/form";
import { EmptyState, Section } from "@/components/staff/page-header";
import { Panel } from "@/components/ui/card";
import type { InterviewExperience } from "@/lib/api-types";
import { communityList } from "@/lib/server/community";
import { requireViewer } from "@/lib/server/session";
import { shareExperience } from "../../community/actions";
import { ExperienceCard } from "./experience-card";

export const metadata: Metadata = { title: "Interview experiences" };

export default async function InterviewsPage({ searchParams }: { searchParams: Promise<{ company?: string }> }) {
  const viewer = await requireViewer();
  if (!viewer.tenantId) redirect("/student");
  const company = (await searchParams).company?.trim();
  const [shared, mine] = await Promise.all([
    communityList<InterviewExperience>(viewer.tenantId, "interview-experiences", { company }),
    communityList<InterviewExperience>(viewer.tenantId, "interview-experiences", { mine: true }),
  ]);
  const waiting = mine.filter((experience) => experience.status !== "approved");
  return (
    <div className="animate-enter">
      <h1 className="display text-[2.25rem] text-ink sm:text-[2.6rem]">Interview experiences</h1>
      <p className="mt-2 max-w-[60ch] text-[15px] text-ink-muted">What seniors in your college were asked, round by round. Posts are anonymous and approved by the placement team first.</p>

      <form className="mt-6 flex max-w-[420px] gap-2" role="search">
        <TextInput name="company" defaultValue={company} placeholder="Filter by company" aria-label="Filter by company" />
        <button type="submit" className="rounded-[var(--radius-control)] bg-hover px-3 text-sm text-ink hover:bg-line">Search</button>
      </form>

      <div className="mt-6 space-y-4">
        {shared.length === 0 ? <EmptyState>{company ? `No approved experiences for “${company}”.` : "No experiences have been approved yet. Be the first to share yours."}</EmptyState> : shared.map((experience) => <ExperienceCard key={experience.id} experience={experience} />)}
      </div>

      {waiting.length > 0 && (
        <Section title="Your submissions" description="Waiting for approval, or sent back with a note.">
          <div className="space-y-4">
            {waiting.map((experience) => (
              <ExperienceCard key={experience.id} experience={experience} />
            ))}
          </div>
        </Section>
      )}

      <Section title="Share yours" description="Company names and rounds help juniors most. Leave out anything under NDA.">
        <Panel className="p-5">
          <ActionForm action={shareExperience} submitLabel="Submit for approval">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Company" htmlFor="company-name">
                <TextInput id="company-name" name="company" maxLength={200} required />
              </Field>
              <Field label="Role" htmlFor="role-name">
                <TextInput id="role-name" name="role" maxLength={200} required />
              </Field>
              <Field label="Level" htmlFor="level">
                <Select id="level" name="experience_level" defaultValue="fresher">
                  <option value="intern">Internship</option>
                  <option value="fresher">Fresher</option>
                  <option value="experienced">Experienced</option>
                </Select>
              </Field>
              <Field label="Drive" htmlFor="drive">
                <Select id="drive" name="drive_type" defaultValue="on-campus">
                  <option value="on-campus">On campus</option>
                  <option value="off-campus">Off campus</option>
                  <option value="pool-campus">Pool campus</option>
                </Select>
              </Field>
              <Field label="Result" htmlFor="verdict">
                <Select id="verdict" name="verdict" defaultValue="selected">
                  <option value="selected">Selected</option>
                  <option value="rejected">Not selected</option>
                  <option value="waitlisted">Waitlisted</option>
                </Select>
              </Field>
              <Field label="Year" htmlFor="year">
                <TextInput id="year" name="year_of_interview" type="number" min={1990} max={2100} defaultValue={new Date().getFullYear()} />
              </Field>
              <Field label="Package (optional)" htmlFor="package" className="sm:col-span-2">
                <TextInput id="package" name="package_offered" maxLength={100} placeholder="For example 6 LPA" />
              </Field>
            </div>
            <RoundsEditor />
            <Field label="How you prepared (optional)" htmlFor="prep">
              <TextArea id="prep" name="preparation_resources" rows={3} maxLength={4000} />
            </Field>
            <Field label="Tips (optional)" htmlFor="tips">
              <TextArea id="tips" name="tips" rows={3} maxLength={4000} />
            </Field>
          </ActionForm>
        </Panel>
      </Section>
    </div>
  );
}
