import type { PracticeProblem } from "@/lib/api-types";
import type { Topic } from "./topic-grid";

export const GENERAL = "general";

/** Topics are the tags problems carry; a problem with none lives in "general". */
export function topicsOf(problems: PracticeProblem[]): Topic[] {
  const byTopic = new Map<string, PracticeProblem[]>();
  for (const problem of problems) for (const tag of problem.tags.length ? problem.tags : [GENERAL]) byTopic.set(tag, [...(byTopic.get(tag) ?? []), problem]);
  return [...byTopic.entries()]
    .map(([name, list]) => ({
      name,
      total: list.length,
      solved: list.filter((problem) => problem.solved).length,
      attempted: list.filter((problem) => problem.attempted && !problem.solved).length,
      easy: list.filter((problem) => problem.difficulty === "easy").length,
      medium: list.filter((problem) => problem.difficulty === "medium").length,
      hard: list.filter((problem) => problem.difficulty === "hard").length,
    }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
}

