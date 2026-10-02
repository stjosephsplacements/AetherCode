import { currentUser, type User } from "./auth.ts";
import { clientIp } from "./client-ip.ts";
import { ipAllowed } from "./net.ts";
import { sql } from "./db.ts";

export interface ActiveAttempt {
  id: string;
  examId: string;
  languages: string[];
  deadlineAt: Date;
}

export const NETWORK_MESSAGE = "This exam can only be taken from the exam lab network.";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

// Anyone signed in may call the exam APIs, but only on attempts they own:
// students on real attempts, staff on their own preview attempts (`ownsAttempt`).
export async function requireExamTaker(): Promise<User> {
  const user = await currentUser();
  if (!user) throw new HttpError(401, "Your session has ended. Sign in again.");
  return user;
}

// SQL guard for an `attempts a` row: owned by this user, and a preview exactly
// when the user is staff. Students can never reach previews or vice versa.
export function ownsAttempt(user: User) {
  return sql`a.user_id = ${user.id} AND a.is_preview = ${user.role !== "student"}`;
}

// The attempt must belong to the caller and still be within its deadline. Preview
// attempts skip the network allow-list so staff can try exams from anywhere.
export async function requireOpenAttempt(attemptId: string, user: User, graceSeconds = 0): Promise<ActiveAttempt> {
  if (!/^[0-9a-f-]{36}$/i.test(attemptId)) throw new HttpError(404, "Attempt not found.");
  const [attempt] = await sql<
    Array<{ id: string; exam_id: string; languages: string[]; deadline_at: Date; open: boolean; is_preview: boolean; allowed_networks: string[] }>
  >`
    SELECT a.id, a.exam_id, e.languages, a.deadline_at, a.is_preview, e.allowed_networks, (a.finished_at IS NULL AND a.deadline_at > now() - make_interval(secs => ${graceSeconds})) AS open
    FROM attempts a JOIN exams e ON e.id = a.exam_id
    WHERE a.id = ${attemptId} AND ${ownsAttempt(user)}`;
  if (!attempt) throw new HttpError(404, "Attempt not found.");
  if (!attempt.open) throw new HttpError(409, "Time is up. Your exam has been submitted.");
  if (!attempt.is_preview && !ipAllowed(await clientIp(), attempt.allowed_networks)) throw new HttpError(403, NETWORK_MESSAGE);
  return { id: attempt.id, examId: attempt.exam_id, languages: attempt.languages, deadlineAt: attempt.deadline_at };
}

// True when this question was assigned to the attempt (one per slot).
export async function questionInAttempt(attemptId: string, questionId: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(questionId)) return false;
  const rows = await sql`SELECT 1 FROM attempt_questions WHERE attempt_id = ${attemptId} AND question_id = ${questionId}`;
  return rows.length > 0;
}

export async function handle(run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status });
    console.error(error);
    return Response.json({ error: "Something went wrong. Try again." }, { status: 500 });
  }
}
