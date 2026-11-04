import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { mathText, toPlatformMarkdown } from "./format.ts";
import { LANGUAGE_IDS } from "./languages.ts";
import { DIFFICULTIES, KINDS, LIMITS, SLUG, cleanTags, slugify, withNewline } from "./platform.ts";

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "Choose a topic.");
const language = z.enum(LANGUAGE_IDS as [string, ...string[]]);

export const QuestionSchema = z
  .object({
    topic_id: uuid,
    kind: z.enum(KINDS),
    title: z.string().trim().min(1, "Give the question a title.").max(LIMITS.title),
    slug: z.string().trim().max(80).optional(),
    difficulty: z.enum(DIFFICULTIES),
    audience: z.enum(["practice", "test"]),
    tags: z.array(z.string()).max(50),
    prompt_markdown: z.string().trim().min(10, "Write the statement students will read.").max(50_000),
    // Coding.
    languages: z.array(language).max(LANGUAGE_IDS.length),
    time_limit_ms: z.number().int().min(100, "The time limit is at least 0.1 seconds.").max(60_000, "The time limit is at most 60 seconds."),
    memory_limit_kib: z.number().int().min(16 * 1024, "The memory limit is at least 16 MB.").max(2048 * 1024, "The memory limit is at most 2048 MB."),
    tests: z.array(z.object({ input: z.string().max(100_000), expected_output: z.string().max(100_000), is_sample: z.boolean(), weight: z.number().int().min(LIMITS.weight.min).max(LIMITS.weight.max) })).max(200),
    solutions: z.array(z.object({ language, source: z.string().min(1, "A model solution cannot be empty.").max(100_000) })).max(LANGUAGE_IDS.length),
    templates: z.array(z.object({ language, starter: z.string().max(8 << 10), prefix: z.string().max(16 << 10), suffix: z.string().max(16 << 10) })).max(LANGUAGE_IDS.length),
    // Multiple choice.
    choices: z.array(z.string()).max(12),
    correct_choices: z.array(z.number().int().min(0)).max(12),
    multiple_choice: z.boolean(),
    choice_explanations: z.array(z.string().max(LIMITS.explanation)).max(12),
  })
  .superRefine((question, context) => {
    const issue = (message: string, path: (string | number)[]) => context.addIssue({ code: "custom", message, path });
    if (!SLUG.test(question.slug?.trim() || slugify(question.title))) issue("The slug needs 3 to 80 letters, digits or hyphens.", ["slug"]);
    if (question.kind === "coding") {
      if (question.languages.length === 0) issue("Choose at least one language.", ["languages"]);
      if (question.tests.length === 0) issue("Add at least one test.", ["tests"]);
      const empty = question.tests.findIndex((test) => test.expected_output.trim() === "");
      if (empty >= 0) issue(`Test ${empty + 1} has no expected output.`, ["tests", empty]);
      if (!question.tests.some((test) => test.is_sample)) issue("Mark at least one test as a sample, so students can run their code.", ["tests"]);
      if (!question.tests.some((test) => !test.is_sample)) issue("Add at least one hidden test. Hidden tests decide the marks.", ["tests"]);
      if (question.solutions.length === 0) issue("Add a model solution in at least one language.", ["solutions"]);
      const outside = question.solutions.find((solution) => !question.languages.includes(solution.language));
      if (outside) issue(`The ${outside.language} solution is for a language the question does not support.`, ["solutions"]);
      if (new Set(question.solutions.map((solution) => solution.language)).size !== question.solutions.length) issue("One model solution per language.", ["solutions"]);
    } else {
      const options = question.choices.map((option) => option.trim());
      if (options.length < 2 || options.some((option) => !option)) issue("Give at least two options, none empty.", ["choices"]);
      if (question.correct_choices.length === 0) issue("Mark the correct answer.", ["correct_choices"]);
      if (!question.multiple_choice && question.correct_choices.length > 1) issue("A single-answer question has one correct option.", ["correct_choices"]);
      if (question.correct_choices.some((index) => index >= options.length)) issue("The correct answer must be one of the options.", ["correct_choices"]);
    }
  });

export type QuestionInput = z.infer<typeof QuestionSchema>;

/** The question exactly as it is stored: statement in the platform's format, tags and slug normalised, tests ending in newlines. */
export function normalizeQuestion(question: QuestionInput): QuestionInput & { slug: string } {
  const mcq = question.kind === "mcq";
  return {
    ...question,
    slug: question.slug?.trim() || slugify(question.title),
    title: question.title.trim(),
    tags: cleanTags(question.tags),
    prompt_markdown: toPlatformMarkdown(question.prompt_markdown).markdown,
    tests: mcq ? [] : question.tests.map((test) => ({ ...test, input: withNewline(test.input), expected_output: withNewline(test.expected_output) })),
    solutions: mcq ? [] : question.solutions,
    languages: mcq ? [] : question.languages,
    templates: mcq ? [] : question.templates.filter((template) => template.starter.trim() || template.prefix || template.suffix),
    choices: mcq ? question.choices.map((option) => mathText(option)) : [],
    correct_choices: mcq ? [...new Set(question.correct_choices)].sort((a, b) => a - b) : [],
    choice_explanations: mcq ? question.choices.map((_, index) => mathText(question.choice_explanations[index] ?? "")) : [],
  };
}

/** The hash of everything a judge verification covers: change any of it and the question needs verifying again. */
export function contentHash(question: QuestionInput): string {
  const normal = normalizeQuestion(question);
  const canonical = JSON.stringify({
    t: normal.title,
    p: normal.prompt_markdown,
    d: normal.difficulty,
    l: [...normal.languages].sort(),
    tl: normal.time_limit_ms,
    ml: normal.memory_limit_kib,
    tests: normal.tests.map((test) => [test.input, test.expected_output, test.is_sample, test.weight]),
    solutions: [...normal.solutions].sort((a, b) => a.language.localeCompare(b.language)).map((solution) => [solution.language, solution.source]),
    templates: [...normal.templates].sort((a, b) => a.language.localeCompare(b.language)).map((template) => [template.language, template.prefix, template.suffix]),
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
