/**
 * What an author enters before a question exists on the server, and the rules
 * that decide whether it may be saved as a draft. The wizard checks them as the
 * author goes; the server action checks them again.
 */

export type Kind = "coding" | "mcq";
export type Difficulty = "easy" | "medium" | "hard";

export type Details = {
  kind: Kind;
  title: string;
  difficulty: Difficulty;
  /** Markdown. */
  prompt: string;
  languages: string[];
  timeSeconds: number;
  memoryMb: number;
  slug: string;
  /** Where the question is filed (ADR-0052). */
  categoryId: string;
  tags: string[];
};

export type TestDraft = { input: string; expected_output: string; sample: boolean; weight: number };
export type Choices = { options: string[]; correct: number[]; multiple: boolean };

export const LIMITS = { timeSeconds: { min: 0.1, max: 60 }, memoryMb: { min: 16, max: 2048 }, weight: { min: 1, max: 100 } } as const;

export const blankTest = (sample: boolean): TestDraft => ({ input: "", expected_output: "", sample, weight: 1 });

export function blankDetails(languages: string[], categoryId = ""): Details {
  return { kind: "coding", title: "", difficulty: "easy", prompt: "", languages, timeSeconds: 2, memoryMb: 256, slug: "", categoryId, tags: [] };
}

export const MAX_TAGS = 50;
export const MAX_TAG_LENGTH = 80;

/** A tag as the question bank stores it: lower case, no padding, words joined by hyphens. */
export const normalizeTag = (raw: string): string => raw.trim().toLowerCase().replace(/[\s_]+/g, "-").replace(/[^\p{L}\p{N}+#.-]/gu, "").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, MAX_TAG_LENGTH);

/** The tags with duplicates and empty ones removed, in the order given. */
export const cleanTags = (tags: string[]): string[] => [...new Set(tags.map(normalizeTag).filter(Boolean))].slice(0, MAX_TAGS);

/** Judge compares whole lines, so every saved value ends in a newline. */
export const withNewline = (value: string) => (value === "" || value.endsWith("\n") ? value : `${value}\n`);

/** The question bank's slug rule is 3 to 80 characters of a-z, 0-9 and hyphens. */
export const SLUG = /^[a-z0-9-]{3,80}$/;

export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60)
    .replace(/-$/, "");
}

export const slugOf = (details: Pick<Details, "slug" | "title">) => details.slug.trim() || slugify(details.title);

/** Why the details cannot be saved yet, or null. */
export function detailsProblem(details: Details, options: { categories: boolean } = { categories: true }): string | null {
  if (!details.title.trim()) return "Give the question a title.";
  if (options.categories && !details.categoryId) return "Choose a category, or add one.";
  if (!details.prompt.trim()) return "Write the statement students will read.";
  if (!SLUG.test(slugOf(details))) return "The slug needs 3 to 80 letters, digits or hyphens. Type one under Advanced.";
  if (details.kind === "coding") {
    if (details.languages.length === 0) return "Choose at least one language.";
    const { timeSeconds, memoryMb } = details;
    if (!(timeSeconds >= LIMITS.timeSeconds.min && timeSeconds <= LIMITS.timeSeconds.max)) return `The time limit is between ${LIMITS.timeSeconds.min} and ${LIMITS.timeSeconds.max} seconds.`;
    if (!(memoryMb >= LIMITS.memoryMb.min && memoryMb <= LIMITS.memoryMb.max)) return `The memory limit is between ${LIMITS.memoryMb.min} and ${LIMITS.memoryMb.max} MB.`;
  }
  return null;
}

/** Why the tests cannot be saved yet, or null. Mirrors what the question bank and the editor need. */
export function testsProblem(tests: TestDraft[]): string | null {
  if (tests.length === 0) return "Add at least one test.";
  const empty = tests.findIndex((test) => test.expected_output.trim() === "");
  if (empty >= 0) return `Test ${empty + 1} has no expected output.`;
  if (!tests.some((test) => test.sample)) return "Mark at least one test as a sample, so students can run their code.";
  if (!tests.some((test) => !test.sample)) return "Add at least one hidden test. Hidden tests decide the marks.";
  const weight = tests.findIndex((test) => !(Number.isInteger(test.weight) && test.weight >= LIMITS.weight.min && test.weight <= LIMITS.weight.max));
  if (weight >= 0) return `Test ${weight + 1} needs a whole-number weight from ${LIMITS.weight.min} to ${LIMITS.weight.max}.`;
  return null;
}

/** Why the options cannot be saved yet, or null. */
export function choicesProblem(choices: Choices): string | null {
  const options = choices.options.map((option) => option.trim());
  if (options.length < 2 || options.some((option) => !option)) return "Give at least two options, none empty.";
  if (choices.correct.length === 0) return "Mark the correct answer.";
  if (!choices.multiple && choices.correct.length > 1) return "A single-answer question has one correct option.";
  if (choices.correct.some((index) => index < 0 || index >= options.length)) return "The correct answer must be one of the options.";
  return null;
}

/** How the author's tests go to the server. */
export const prepareTests = (tests: TestDraft[]): TestDraft[] => tests.map((test) => ({ ...test, input: withNewline(test.input), expected_output: withNewline(test.expected_output) }));

export type TestsSummary = { total: number; sample: number; hidden: number; weight: number };

export function summarizeTests(tests: TestDraft[]): TestsSummary {
  const sample = tests.filter((test) => test.sample).length;
  return { total: tests.length, sample, hidden: tests.length - sample, weight: tests.reduce((sum, test) => sum + test.weight, 0) };
}

/** A test's share of the marks, as a whole percentage. */
export const marksShare = (test: TestDraft, tests: TestDraft[]): number => {
  const total = summarizeTests(tests).weight;
  return total === 0 ? 0 : Math.round((test.weight / total) * 100);
};

export const MAX_UPLOADED_TESTS = 200;

/**
 * Reads a test file: a JSON array. Takes this editor's keys (`expected_output`, `sample`) and
 * the exam-app ones (`output`, `isHidden`), so a file from either works.
 */
export function parseTestFile(text: string): { tests: TestDraft[]; error?: undefined } | { tests?: undefined; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { error: "That file is not valid JSON." };
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return { error: "Expected a JSON list with at least one test." };
  if (parsed.length > MAX_UPLOADED_TESTS) return { error: `At most ${MAX_UPLOADED_TESTS} tests can be uploaded at once.` };
  const tests: TestDraft[] = [];
  for (const [position, entry] of parsed.entries()) {
    const item = (entry ?? {}) as Record<string, unknown>;
    const input = item.input;
    const output = item.expected_output ?? item.output;
    if (typeof input !== "string" || typeof output !== "string") return { error: `Test ${position + 1} needs "input" and "expected_output" as text.` };
    const hidden = typeof item.isHidden === "boolean" ? item.isHidden : typeof item.hidden === "boolean" ? item.hidden : undefined;
    const sample = typeof item.sample === "boolean" ? item.sample : hidden === undefined ? false : !hidden;
    const weight = item.weight === undefined ? 1 : Number(item.weight);
    tests.push({ input, expected_output: output, sample, weight });
  }
  return { tests: prepareTests(tests) };
}
