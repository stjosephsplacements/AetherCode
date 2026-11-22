/**
 * The forgot and reset pages: the reset link carries a one-time bearer in its address, and the forgot page takes an
 * email. No third-party script may run on them, so analytics skip these paths and next.config.ts serves them a CSP
 * without third-party hosts.
 */
const RESET_PATHS = ["/auth/forgot-password", "/auth/reset-password"] as const;

export function isResetPath(pathname: string): boolean {
  return RESET_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

/** Reset by email is offered only where the operator has set up mail in the identity service (PASSWORD_RESET_EMAIL=on). */
export function passwordResetByEmail(): boolean {
  return process.env.PASSWORD_RESET_EMAIL === "on";
}
