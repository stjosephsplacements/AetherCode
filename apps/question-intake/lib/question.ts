import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { LANGUAGE_IDS } from "./languages.ts";

const text = (max: number) => z.string().max(max);

export const TestSchema = z.object({
  input: text(100_000),
  expected_output: text(100_000).min(1, "A test needs an expected output."),
  is_sample: z.boolean(),
});

export const QuestionSchema = z
  .object({
    title: z.string().trim().min(3, "Give the question a title.").max(200),
    difficulty: z.enum(["easy", "medium", "hard"]),
    topics: z.array(z.string().trim().min(1).max(40)).max(12),
    statement_md: z.string().min(10, "Write the problem statement.").max(50_000),
    input_format: text(5_000),
    output_format: text(5_000),
    constraints_md: text(5_000),
    time_limit_ms: z.number().int().min(100).max(20_000),
    memory_limit_kb: z.number().int().min(16_384).max(2_097_152),
    tests: z.array(TestSchema).min(2, "Add at least two tests.").max(100),
    solutions: z
      .array(z.object({ language: z.enum(LANGUAGE_IDS as [string, ...string[]]), source: z.string().min(1, "A model solution cannot be empty.").max(100_000) }))
      .min(1, "Add a model solution in at least one language.")
      .max(LANGUAGE_IDS.length),
  })
  .refine((question) => question.tests.some((test) => test.is_sample), { message: "Mark at least one test as a sample students can see.", path: ["tests"] })
  .refine((question) => new Set(question.solutions.map((solution) => solution.language)).size === question.solutions.length, {
    message: "One model solution per language.",
    path: ["solutions"],
  });

export type QuestionInput = z.infer<typeof QuestionSchema>;

/** The hash of everything a judge verification covers: change any of it and the question needs verifying again. */
export function contentHash(question: QuestionInput): string {
  const canonical = JSON.stringify({
    t: question.title.trim(),
    d: question.difficulty,
    s: question.statement_md,
    tl: question.time_limit_ms,
    ml: question.memory_limit_kb,
    tests: question.tests.map((test) => [test.input, test.expected_output, test.is_sample]),
    solutions: [...question.solutions].sort((a, b) => a.language.localeCompare(b.language)).map((solution) => [solution.language, solution.source]),
  });
  return createHash("sha256").update(canonical).digest("hex");
}

const TOKEN_LIFETIME_MS = 30 * 60_000;

function secret(): string {
  const value = process.env.VERIFY_SECRET;
  if (!value) throw new Error("VERIFY_SECRET is required");
  return value;
}

/** Proof that a question with this hash passed the judge; the save step accepts nothing else. */
export function signVerification(hash: string, principalId: string, now = Date.now()): string {
  const expires = now + TOKEN_LIFETIME_MS;
  const mac = createHmac("sha256", secret()).update(`${hash}.${principalId}.${expires}`).digest("hex");
  return `${expires}.${mac}`;
}

export function checkVerification(token: string, hash: string, principalId: string, now = Date.now()): boolean {
  const [expires, mac] = token.split(".");
  if (!expires || !mac || Number(expires) < now) return false;
  const expected = createHmac("sha256", secret()).update(`${hash}.${principalId}.${expires}`).digest("hex");
  const a = Buffer.from(mac, "hex");
  const b = Buffer.from(expected, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
