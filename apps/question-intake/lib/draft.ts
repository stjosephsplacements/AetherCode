import type { LanguageId } from "./languages.ts";

export type Draft = {
  title: string;
  difficulty: "easy" | "medium" | "hard";
  topics: string;
  statement_md: string;
  input_format: string;
  output_format: string;
  constraints_md: string;
  time_limit_ms: number;
  memory_limit_kb: number;
  tests: { input: string; expected_output: string; is_sample: boolean }[];
  solutions: Partial<Record<LanguageId, string>>;
};

export const emptyDraft = (): Draft => ({
  title: "",
  difficulty: "easy",
  topics: "",
  statement_md: "",
  input_format: "",
  output_format: "",
  constraints_md: "",
  time_limit_ms: 2000,
  memory_limit_kb: 262144,
  tests: [
    { input: "", expected_output: "", is_sample: true },
    { input: "", expected_output: "", is_sample: false },
  ],
  solutions: {},
});
