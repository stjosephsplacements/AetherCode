import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeStaff } from "@/lib/authorize.ts";
import { sql } from "@/lib/db";

const Body = z.object({
  bank_question_id: z.string().uuid(),
  bank_version_id: z.string().uuid(),
  idempotency_key: z.string().min(8).max(200),
});

/** Records a platform bank id after a successful import (idempotent on intake_question_id and key). */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeStaff(request);
  if (auth instanceof NextResponse) return auth;
  const { id: intakeQuestionId } = await params;
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await request.json());
  } catch {
    return NextResponse.json({ code: "invalid_argument", message: "bank ids and idempotency key are required." }, { status: 400 });
  }
  const [question] = await sql`SELECT id FROM questions WHERE id = ${intakeQuestionId}`;
  if (!question) return NextResponse.json({ code: "not_found", message: "Question not found." }, { status: 404 });

  const [existing] = await sql`SELECT intake_question_id, bank_question_id, bank_version_id FROM question_bank_links WHERE intake_question_id = ${intakeQuestionId}`;
  if (existing) {
    return NextResponse.json({
      intake_question_id: existing.intake_question_id,
      bank_question_id: existing.bank_question_id,
      bank_version_id: existing.bank_version_id,
      created: false,
    });
  }

  try {
    await sql`
      INSERT INTO question_bank_links (intake_question_id, bank_question_id, bank_version_id, idempotency_key, linked_by)
      VALUES (${intakeQuestionId}, ${body.bank_question_id}, ${body.bank_version_id}, ${body.idempotency_key}, ${auth.viewer.principalId})`;
  } catch (error) {
    const code = String(error);
    if (code.includes("unique") || code.includes("23505")) {
      const [row] = await sql`SELECT intake_question_id, bank_question_id, bank_version_id FROM question_bank_links WHERE idempotency_key = ${body.idempotency_key}`;
      if (row) return NextResponse.json({ ...row, created: false });
    }
    throw error;
  }
  return NextResponse.json({ intake_question_id: intakeQuestionId, bank_question_id: body.bank_question_id, bank_version_id: body.bank_version_id, created: true }, { status: 201 });
}