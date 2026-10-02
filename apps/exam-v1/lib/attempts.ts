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

export async function requireStudent(): Promise<User> {
  const user = await currentUser();
  if (!user) throw new HttpError(401, "Your session has ended. Sign in again.");
  if (user.role !== "student") throw new HttpError(403, "Only students can do this.");
  return user;
}

// The attempt must belong to the student and still be within its deadline.
export async function requireOpenAttempt(attemptId: string, user: User, graceSeconds = 0): Promise<ActiveAttempt> {
  if (!/^[0-9a-f-]{36}$/i.test(attemptId)) throw new HttpError(404, "Attempt not found.");
  const [attempt] = await sql<
    Array<{ id: string; exam_id: string; languages: string[]; deadline_at: Date; open: boolean; allowed_networks: string[] }>
  >`
    SELECT a.id, a.exam_id, e.languages, a.deadline_at, e.allowed_networks, (a.finished_at IS NULL AND a.deadline_at > now() - make_interval(secs => ${graceSeconds})) AS open
    FROM attempts a JOIN exams e ON e.id = a.exam_id
    WHERE a.id = ${attemptId} AND a.user_id = ${user.id}`;
  if (!attempt) throw new HttpError(404, "Attempt not found.");
  if (!attempt.open) throw new HttpError(409, "Time is up. Your exam has been submitted.");
  if (!ipAllowed(await clientIp(), attempt.allowed_networks)) throw new HttpError(403, NETWORK_MESSAGE);
  return { id: attempt.id, examId: attempt.exam_id, languages: attempt.languages, deadlineAt: attempt.deadline_at };
}

export async function questionInExam(examId: string, questionId: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(questionId)) return false;
  const rows = await sql`SELECT 1 FROM exam_questions WHERE exam_id = ${examId} AND question_id = ${questionId}`;
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
