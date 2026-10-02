export type ExamPhase = "draft" | "scheduled" | "live" | "closed";

export function examPhase(exam: { published: boolean; starts_at: Date; ends_at: Date }, now = new Date()): ExamPhase {
  if (!exam.published) return "draft";
  if (now < exam.starts_at) return "scheduled";
  if (now < exam.ends_at) return "live";
  return "closed";
}

export const PHASE_TONE = { draft: "neutral", scheduled: "brand", live: "pass", closed: "accent" } as const;

export const formatWhen = (date: Date) =>
  date.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
