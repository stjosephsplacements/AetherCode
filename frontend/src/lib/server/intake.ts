import "server-only";
import { cookies } from "next/headers";
import { ACCESS_COOKIE } from "./tokens";

export const INTAKE_TOPIC_FORMAT = "aethercode.intake.topic.v1" as const;

function intakeUrl(): string {
  const url = process.env.QUESTION_INTAKE_URL?.trim().replace(/\/+$/, "");
  if (!url) throw new Error("QUESTION_INTAKE_URL is not set; the bank cannot reach question intake.");
  return url;
}

async function intake<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) throw new Error("Your session has ended. Sign in again.");
  const response = await fetch(`${intakeUrl()}${path}`, {
    ...init,
    headers: {
      accept: "application/json",
      authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = (payload as { message?: string } | null)?.message ?? `Question intake returned HTTP ${response.status}`;
    throw new Error(message);
  }
  return payload as T;
}

export type IntakeTopic = { id: string; name: string; parent_name: string | null; question_count: number };

export type IntakeExportQuestion = {
  intake_question_id: string;
  slug: string;
  kind: "coding" | "mcq";
  audience: "test" | "practice";
  tags: string[];
  title: string;
  prompt_markdown: string;
  difficulty: "easy" | "medium" | "hard";
  supported_languages: string[];
  time_limit_ms: number;
  memory_limit_kib: number;
  choices: string[] | null;
  correct_choices: number[] | null;
  multiple_choice: boolean;
  choice_explanations: (string | null)[] | null;
  tests: { position: number; input: string; expected_output: string; sample: boolean; weight: number }[];
  model_solutions: { language: string; source: string }[];
  templates: { language: string; starter: string; prefix: string; suffix: string }[];
  bank_link: { question_id: string; version_id: string } | null;
};

export type IntakeTopicExport = {
  format: typeof INTAKE_TOPIC_FORMAT;
  exported_at: string;
  topic: { id: string; name: string; parent_name: string | null };
  questions: IntakeExportQuestion[];
};

export async function listIntakeTopics(): Promise<IntakeTopic[]> {
  const payload = await intake<{ topics: IntakeTopic[] }>("/api/topics");
  return payload.topics.filter((topic) => topic.question_count > 0);
}

export async function exportIntakeTopic(topicId: string): Promise<IntakeTopicExport> {
  const payload = await intake<IntakeTopicExport>(`/api/topics/${encodeURIComponent(topicId)}/export`);
  if (payload.format !== INTAKE_TOPIC_FORMAT || !Array.isArray(payload.questions)) {
    throw new Error("The intake export is not a topic bundle.");
  }
  return payload;
}

export async function recordIntakeBankLink(intakeQuestionId: string, body: { bank_question_id: string; bank_version_id: string; idempotency_key: string }): Promise<void> {
  await intake(`/api/questions/${encodeURIComponent(intakeQuestionId)}/bank-link`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}