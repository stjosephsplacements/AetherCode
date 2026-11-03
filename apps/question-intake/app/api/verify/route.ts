import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { QuestionSchema, contentHash, signVerification } from "@/lib/question";
import { requireViewer } from "@/lib/session";
import { verifyQuestion } from "@/lib/verify";

export const maxDuration = 300;

/** Runs the model solutions against every test in the hosted judge. Nothing is saved here. */
export async function POST(request: Request) {
  const { viewer } = await requireViewer();
  const parsed = QuestionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues.map((issue) => issue.message).join(" ") }, { status: 400 });
  }
  const question = parsed.data;
  let verification;
  try {
    verification = await verifyQuestion(question);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The judge could not be reached." }, { status: 502 });
  }
  const hash = contentHash(question);
  await sql`INSERT INTO verifications (content_hash, passed, results, run_by_principal_id) VALUES (${hash}, ${verification.passed}, ${sql.json(verification as never)}, ${viewer.principalId})`;
  return NextResponse.json({ ...verification, hash, token: verification.passed ? signVerification(hash, viewer.principalId) : null });
}
