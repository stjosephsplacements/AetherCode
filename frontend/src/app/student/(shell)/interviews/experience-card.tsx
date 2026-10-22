import { Trash2 } from "lucide-react";
import { Markdown } from "@/components/markdown";
import { Badge, Panel } from "@/components/ui/card";
import type { InterviewExperience } from "@/lib/api-types";
import { deleteExperience } from "../../community/actions";

const VERDICT = { selected: ["Selected", "success"], rejected: ["Not selected", "danger"], waitlisted: ["Waitlisted", "warning"] } as const;
const STATUS = { pending: ["Waiting for approval", "warning"], approved: ["Approved", "success"], rejected: ["Sent back", "danger"] } as const;

export function ExperienceCard({ experience }: { experience: InterviewExperience }) {
  const [verdict, verdictTone] = VERDICT[experience.verdict];
  const [status, statusTone] = STATUS[experience.status];
  return (
    <Panel className="p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-[16px] font-semibold text-ink">
          {experience.company}, {experience.role}
        </h2>
        <Badge tone={verdictTone}>{verdict}</Badge>
        {experience.mine && <Badge tone={statusTone}>{status}</Badge>}
      </div>
      <p className="mt-1 text-[13px] text-ink-muted">
        {[experience.experience_level, experience.drive_type, experience.year_of_interview, experience.package_offered].filter(Boolean).join(" · ")}
      </p>
      {experience.review_note && experience.mine && <p className="mt-2 rounded bg-hover px-3 py-2 text-sm text-ink">Note from the placement team: {experience.review_note}</p>}
      <ol className="mt-4 space-y-3">
        {experience.rounds.map((round, index) => (
          <li key={index} className="text-sm">
            <p className="font-medium text-ink">
              {index + 1}. {round.title}
            </p>
            {round.description && <p className="mt-0.5 whitespace-pre-line leading-relaxed text-ink-muted">{round.description}</p>}
          </li>
        ))}
      </ol>
      {experience.preparation_resources && (
        <div className="mt-4">
          <p className="text-[13px] font-medium text-ink-muted">How they prepared</p>
          <Markdown>{experience.preparation_resources}</Markdown>
        </div>
      )}
      {experience.tips && (
        <div className="mt-4">
          <p className="text-[13px] font-medium text-ink-muted">Tips</p>
          <Markdown>{experience.tips}</Markdown>
        </div>
      )}
      {experience.mine && (
        <form action={deleteExperience} className="mt-4">
          <input type="hidden" name="id" value={experience.id} />
          <button type="submit" className="inline-flex items-center gap-1.5 text-[13px] text-ink-muted hover:text-danger">
            <Trash2 className="size-3.5" strokeWidth={1.75} />
            Delete my post
          </button>
        </form>
      )}
    </Panel>
  );
}
