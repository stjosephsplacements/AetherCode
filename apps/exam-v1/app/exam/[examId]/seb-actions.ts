"use server";

import { markSessionSebVerified, requireUser } from "@/lib/auth";
import { publicOrigin } from "@/lib/public-url";
import { isSebConfigKeyRequest } from "@/lib/seb";

/** Checks a SafeExamBrowser.security.configKey value for one of our pages and, if valid, marks the session. */
export async function verifySebPage(pageUrl: string, configKeyHash: string): Promise<boolean> {
  await requireUser("student");
  const origin = await publicOrigin();
  if (URL.parse(pageUrl)?.origin !== origin || !isSebConfigKeyRequest(pageUrl, configKeyHash, origin)) return false;
  await markSessionSebVerified();
  return true;
}

/** Logs why a SEB JavaScript API check failed, so failures on unusual SEB builds can be diagnosed. */
export async function reportSebCheck(reason: string, _pageUrl: string): Promise<void> {
  await requireUser("student");
  const allowedReasons = new Set([
    "missing-seb-api",
    "invalid-config-key",
    "url-mismatch",
    "origin-mismatch",
    "missing-origin",
  ]);
  const safeReason = allowedReasons.has(reason) ? reason : "unknown";
  console.warn(`SEB check failed for student: ${safeReason}`);
}
