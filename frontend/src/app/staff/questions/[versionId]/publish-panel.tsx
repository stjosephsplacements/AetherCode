import { Lock } from "lucide-react";
import { ActionForm, Field, Select } from "@/components/staff/form";
import { Button } from "@/components/ui/button";
import type { QuestionVersion } from "@/lib/api-types";
import { publishQuestion, requestReview } from "../actions";

type Reviewer = { id: string; name: string };

/** Why a draft cannot be published yet, or null when it can. */
export function publishBlocker(version: QuestionVersion, verified: boolean): string | null {
  const choice = version.kind === "mcq" || version.supported_languages.length === 0;
  if (choice) return version.kind === "mcq" ? null : "Save the options and the correct answer first.";
  if (version.sample_test_case_count === 0 || version.hidden_test_case_count === 0) return "Save at least one sample and one hidden test first.";
  if (!verified) return "Verify the question first: a model solution has to pass every test, hidden ones included. Changing the tests asks for a new check.";
  return null;
}

/**
 * The last step. A draft that is not verified shows a locked button and the
 * reason, so the gate is visible; the server refuses it as well (ADR-0047).
 */
export function PublishPanel({
  version,
  blocker,
  requireReview,
  reviewers,
  viewerId,
}: {
  version: QuestionVersion;
  blocker: string | null;
  requireReview: boolean;
  reviewers: Reviewer[];
  viewerId: string;
}) {
  const hidden = (
    <>
      <input type="hidden" name="version_id" value={version.id} />
      <input type="hidden" name="expected_version" value={version.version} />
    </>
  );
  if (blocker) {
    return (
      <div className="space-y-3">
        <Button type="button" disabled aria-describedby="publish-blocker">
          <Lock />
          {requireReview ? "Ask for a review" : "Publish question"}
        </Button>
        <p id="publish-blocker" className="text-[13px] text-ink-muted">
          {blocker}
        </p>
      </div>
    );
  }
  if (!requireReview) {
    return (
      <div className="space-y-3">
        <p className="text-[13px] text-ink-muted">Published questions cannot be edited; you can start a new draft version later.</p>
        <ActionForm action={publishQuestion} submitLabel="Publish question">
          {hidden}
        </ActionForm>
      </div>
    );
  }
  if (!version.review_requested_at) {
    return (
      <div className="space-y-3">
        <p className="text-[13px] text-ink-muted">A different member of staff has to approve this question before it is published.</p>
        <ActionForm action={requestReview} submitLabel="Ask for a review">
          {hidden}
          {reviewers.length > 0 && (
            <Field label="Reviewer (optional)" hint="Anyone else on staff can still approve" htmlFor="reviewer">
              <Select id="reviewer" name="reviewer_id" defaultValue="">
                <option value="">Any reviewer</option>
                {reviewers.map((reviewer) => (
                  <option key={reviewer.id} value={reviewer.id}>
                    {reviewer.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </ActionForm>
      </div>
    );
  }
  if (version.review_requested_by === viewerId) {
    return <p className="text-sm text-ink-muted">Waiting for another member of staff to review it. If you change it, ask again.</p>;
  }
  return (
    <div className="space-y-3">
      <p className="text-[13px] text-ink-muted">
        {version.assigned_reviewer_id === viewerId ? "This was sent to you. " : ""}Read the statement and tests, then approve. Approving publishes this version.
      </p>
      <ActionForm action={publishQuestion} submitLabel="Approve and publish">
        {hidden}
      </ActionForm>
    </div>
  );
}
