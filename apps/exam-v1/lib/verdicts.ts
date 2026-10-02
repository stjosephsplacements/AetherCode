export const VERDICT_LABEL: Record<string, string> = {
  accepted: "Accepted",
  wrong_answer: "Wrong answer",
  time_limit_exceeded: "Time limit exceeded",
  runtime_error: "Runtime error",
  compile_error: "Compilation error",
  internal_error: "System error",
  ran: "Ran",
};

export const VERDICT_TONE: Record<string, "pass" | "fail" | "error" | "neutral" | "brand"> = {
  accepted: "pass",
  wrong_answer: "fail",
  time_limit_exceeded: "fail",
  runtime_error: "fail",
  compile_error: "error",
  internal_error: "error",
  ran: "brand",
};
