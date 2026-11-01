import "server-only";
import type { Language } from "@/lib/languages";
import { GatewayError, gateway } from "./gateway";

/**
 * Used only while the question bank predates GET /v1/languages (a rolling
 * deploy, or a gateway still on the old build). The service's own list wins
 * the moment it answers.
 */
const FALLBACK: Language[] = [
  { key: "c", name: "C", editor: "c" },
  { key: "cpp17", name: "C++17", editor: "cpp" },
  { key: "java", name: "Java", editor: "java" },
  { key: "python3", name: "Python 3", editor: "python" },
  { key: "javascript", name: "JavaScript", editor: "javascript" },
  { key: "go", name: "Go", editor: "go" },
];

export async function listLanguages(): Promise<{ languages: Language[]; fromService: boolean }> {
  try {
    const { languages } = await gateway<{ languages: Language[] }>("/question-bank/v1/languages");
    if (Array.isArray(languages) && languages.length > 0) return { languages, fromService: true };
  } catch (error) {
    // 404: an older service. Anything else (401, 5xx) is surfaced by the page's own requests.
    if (!(error instanceof GatewayError) || error.status !== 404) console.warn("could not load languages", error instanceof Error ? error.message : error);
  }
  return { languages: FALLBACK, fromService: false };
}
