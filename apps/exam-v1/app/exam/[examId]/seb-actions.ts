"use server";

import { headers } from "next/headers";
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
export async function reportSebCheck(reason: string, pageUrl: string): Promise<void> {
  const user = await requireUser("student");
  const userAgent = (await headers()).get("user-agent") ?? "";
  console.warn(`SEB check failed for ${user.username}: ${reason.slice(0, 100)} at ${pageUrl.slice(0, 300)} (origin ${await publicOrigin()}, UA ${userAgent.slice(0, 200)})`);
}
