import type { User } from "./auth.ts";
import { sql } from "./db.ts";

export type AuditAction =
  | "students.import"
  | "staff.create"
  | "password.reset"
  | "batch.reissue"
  | "user.disable"
  | "user.enable"
  | "question.create"
  | "question.update"
  | "question.regrade"
  | "questions.import"
  | "exam.create"
  | "exam.clone"
  | "exam.update"
  | "attempt.extend"
  | "exam.extend"
  | "exam.announce"
  | "results.release"
  | "results.hide";

// Records who did what. Called after the change succeeds; never throws into the
// caller, because a logging failure must not undo or block the action itself.
export async function audit(user: User, action: AuditAction, target: string, details: Record<string, unknown> = {}): Promise<void> {
  try {
    await sql`
      INSERT INTO audit_log (actor_id, actor, action, target, details)
      VALUES (${user.id}, ${`${user.name} (${user.username})`}, ${action}, ${target}, ${sql.json(details as never)})`;
  } catch (error) {
    console.error("audit log write failed:", action, target, error);
  }
}
