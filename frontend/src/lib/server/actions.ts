import "server-only";
import { GatewayError } from "./gateway";

/** A message for a failed staff action, safe to show in the form. */
export function actionError(error: unknown): string {
  if (error instanceof GatewayError) {
    if (error.status === 403) return "Your role cannot do this. Ask a college administrator.";
    if (error.status === 409) return `${error.message}. Reload the page and try again.`;
    return error.message;
  }
  return "Something went wrong. Try again.";
}
