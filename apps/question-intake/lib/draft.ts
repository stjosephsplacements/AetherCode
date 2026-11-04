import type { LanguageId } from "./languages.ts";
import type { Difficulty, Kind } from "./platform.ts";

export type TestDraft = { input: string; expected_output: string; is_sample: boolean; weight: number };
export type TemplateDraft = { starter: string; prefix: string; suffix: string };

/** What an author is editing: the same fields the platform's wizard has, in the units the form shows. */
export type Draft = {
  topicId: string;
  kind: Kind;
  title: string;
  slug: string;
  difficulty: Difficulty;
  audience: "practice" | "test";
  tags: string[];
  prompt: string;
  languages: LanguageId[];
  timeSeconds: number;
  memoryMb: number;
  tests: TestDraft[];
  solutions: Partial<Record<LanguageId, string>>;
  templates: Partial<Record<LanguageId, TemplateDraft>>;
  choices: string[];
  correct: number[];
  multiple: boolean;
  explanations: string[];
};

export const blankTest = (is_sample: boolean): TestDraft => ({ input: "", expected_output: "", is_sample, weight: 1 });

export function blankDraft(topicId = "", difficulty: Difficulty = "easy"): Draft {
  return {
    topicId,
    kind: "coding",
    title: "",
    slug: "",
    difficulty,
    audience: "practice",
    tags: [],
    prompt: "",
    languages: ["python3"],
    timeSeconds: 2,
    memoryMb: 256,
    tests: [blankTest(true), blankTest(false)],
    solutions: {},
    templates: {},
    choices: ["", ""],
    correct: [],
    multiple: false,
    explanations: ["", ""],
  };
}

/** The server's input, from the form's. */
export function toPayload(draft: Draft) {
  const mcq = draft.kind === "mcq";
  return {
    topic_id: draft.topicId,
    kind: draft.kind,
    title: draft.title,
    slug: draft.slug,
    difficulty: draft.difficulty,
    audience: draft.audience,
    tags: draft.tags,
    prompt_markdown: draft.prompt,
    languages: mcq ? [] : draft.languages,
    time_limit_ms: Math.round(draft.timeSeconds * 1000),
    memory_limit_kib: Math.round(draft.memoryMb * 1024),
    tests: mcq ? [] : draft.tests,
    solutions: mcq ? [] : Object.entries(draft.solutions).filter(([language, source]) => draft.languages.includes(language as LanguageId) && (source ?? "").trim() !== "").map(([language, source]) => ({ language, source: source! })),
    templates: mcq ? [] : Object.entries(draft.templates).filter(([language]) => draft.languages.includes(language as LanguageId)).map(([language, template]) => ({ language, starter: template!.starter, prefix: template!.prefix, suffix: template!.suffix })),
    choices: mcq ? draft.choices : [],
    correct_choices: mcq ? draft.correct : [],
    multiple_choice: mcq && draft.multiple,
    choice_explanations: mcq ? draft.choices.map((_, index) => draft.explanations[index] ?? "") : [],
  };
}

export type StepId = "details" | "statement" | "tests" | "solutions" | "options" | "verify";

export const stepsFor = (kind: Kind): StepId[] => (kind === "coding" ? ["details", "statement", "tests", "solutions", "verify"] : ["details", "statement", "options", "verify"]);

/** Why a step cannot be left yet, or null when it is complete. */
export function stepProblem(step: StepId, draft: Draft): string | null {
  switch (step) {
    case "details":
      if (!draft.topicId) return "Choose a topic, or create one.";
      if (!draft.title.trim()) return "Give the question a title.";
      if (draft.kind === "coding") {
        if (draft.languages.length === 0) return "Choose at least one language.";
        if (!(draft.timeSeconds >= 0.1 && draft.timeSeconds <= 60)) return "The time limit is between 0.1 and 60 seconds.";
        if (!(draft.memoryMb >= 16 && draft.memoryMb <= 2048)) return "The memory limit is between 16 and 2048 MB.";
      }
      return null;
    case "statement":
      return draft.prompt.trim().length < 10 ? "Write the statement students will read." : null;
    case "tests": {
      if (draft.tests.length === 0) return "Add at least one test.";
      const empty = draft.tests.findIndex((test) => test.expected_output.trim() === "");
      if (empty >= 0) return `Test ${empty + 1} has no expected output.`;
      if (!draft.tests.some((test) => test.is_sample)) return "Mark at least one test as a sample, so students can run their code.";
      if (!draft.tests.some((test) => !test.is_sample)) return "Add at least one hidden test. Hidden tests decide the marks.";
      const weight = draft.tests.findIndex((test) => !(Number.isInteger(test.weight) && test.weight >= 1 && test.weight <= 100));
      return weight >= 0 ? `Test ${weight + 1} needs a whole-number weight from 1 to 100.` : null;
    }
    case "solutions": {
      const written = draft.languages.filter((language) => (draft.solutions[language] ?? "").trim() !== "");
      return written.length === 0 ? "Add a model solution in at least one of the chosen languages." : null;
    }
    case "options": {
      const options = draft.choices.map((option) => option.trim());
      if (options.length < 2 || options.some((option) => !option)) return "Give at least two options, none empty.";
      if (draft.correct.length === 0) return "Mark the correct answer.";
      if (!draft.multiple && draft.correct.length > 1) return "A single-answer question has one correct option.";
      return null;
    }
    default:
      return null;
  }
}
