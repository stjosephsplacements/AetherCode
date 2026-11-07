// A student submits an interview experience and staff approve it from the moderation queue.
import { expect, test } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { setUp } from "./seed";
import { adminEmail, adminPassword, adminTotpSecret, dismissOnboarding, freshTotp } from "./support";

const run = randomBytes(3).toString("hex").toUpperCase();

test("a student submits an interview experience and staff approve it", async ({ browser }) => {
  test.setTimeout(420_000);
  const seed = await setUp(run, 3_600_000);

  // Student: sign in and change the one-time password.
  const studentCtx = await browser.newContext();
  const student = await studentCtx.newPage();
  await student.goto("/login");
  await student.getByLabel("Roll number or username").fill(seed.roll);
  await student.locator("#password").fill(seed.password);
  await student.getByRole("button", { name: /sign in/i }).click();
  await student.waitForURL("**/account/password**");
  const chosen = `Cm-${run}-Changed1x`;
  await student.getByLabel("Password you were given").fill(seed.password);
  await student.getByLabel("New password", { exact: true }).fill(chosen);
  await student.getByLabel("New password again").fill(chosen);
  await student.getByRole("button", { name: "Save password" }).click();
  await student.waitForURL((url) => !url.pathname.startsWith("/account/password"));

  // Submit an interview experience.
  await student.goto("/student/interviews");
  const company = `E2E Corp ${run}`;
  await student.locator("#company-name").fill(company);
  await student.locator("#role-name").fill("Software Engineer");
  // Round 1 fields are already visible (the editor starts with one round).
  await student.locator('[name="round_title_0"]').fill("Online assessment");
  await student.locator('[name="round_description_0"]').fill("Two coding questions, 90 minutes.");
  await student.getByRole("button", { name: "Submit for approval" }).click();
  // The success message appears.
  await expect(student.getByText("placement team for approval")).toBeVisible({ timeout: 30_000 });

  // Staff: sign in and open the community moderation page.
  const staffCtx = await browser.newContext();
  const teacher = await staffCtx.newPage();
  await teacher.goto("/login");
  await teacher.getByLabel("Roll number or username").fill(adminEmail);
  await teacher.locator("#password").fill(adminPassword);
  await teacher.getByRole("button", { name: /sign in/i }).click();
  await teacher.locator("#code").fill(await freshTotp(adminTotpSecret!));
  await teacher.getByRole("button", { name: /verify and sign in/i }).click();
  await teacher.waitForURL("**/admin");
  await teacher.goto(`/admin/open?college=${seed.tenant}&next=${encodeURIComponent("/staff")}`);
  await dismissOnboarding(teacher);

  // The experience shows in the moderation queue.
  await expect(async () => {
    await teacher.goto("/staff/community");
    await expect(teacher.getByText(company).first()).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 90_000 });

  // Open the experience dialog and approve it.
  await teacher.getByText(company).first().click();
  const dialog = teacher.getByRole("dialog", { name: new RegExp(company) });
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await expect(dialog.getByText("Online assessment")).toBeVisible();
  await dialog.getByRole("button", { name: "Approve" }).click();
  // The dialog closes and the queue no longer contains this experience.
  await expect(dialog).toBeHidden({ timeout: 30_000 });

  // The student now sees the approved experience in the public list.
  await expect(async () => {
    await student.goto("/student/interviews");
    await expect(student.getByText(company).first()).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 60_000 });
});
