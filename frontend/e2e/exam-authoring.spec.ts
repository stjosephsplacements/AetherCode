// Staff create an exam through the browser: fill in the new-exam form (title, dates, duration),
// add a question on the exam page, publish the exam, and assign it to a batch.
import { expect, test } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { setUp } from "./seed";
import { adminEmail, adminPassword, adminTotpSecret, dismissOnboarding, freshTotp, pickDateTime } from "./support";

const run = randomBytes(3).toString("hex").toUpperCase();

test("staff create, build and publish an exam through the UI", async ({ page }) => {
  test.setTimeout(300_000);
  const seed = await setUp(run, 3_600_000);
  // The seed spends the administrator's request budget (the gateway limits each signed-in user); let it refill before the UI runs.
  await new Promise((resolve) => setTimeout(resolve, 15_000));

  await page.goto("/login");
  await page.getByLabel("Roll number or username").fill(adminEmail);
  await page.locator("#password").fill(adminPassword);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.locator("#code").fill(await freshTotp(adminTotpSecret!));
  await page.getByRole("button", { name: /verify and sign in/i }).click();
  await page.waitForURL("**/admin");
  await page.goto(`/admin/open?college=${seed.tenant}&next=${encodeURIComponent("/staff")}`);
  await dismissOnboarding(page);

  // Create the exam through the new-exam form.
  const title = `UI exam ${run}`;
  await page.goto("/staff/exams/new");
  await page.getByLabel("Title").fill(title);
  const opens = new Date(Date.now() + 600_000);
  const closes = new Date(opens.getTime() + 7_200_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  const local = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  await pickDateTime(page, "exam-opens", local(opens));
  await pickDateTime(page, "exam-closes", local(closes));
  await page.locator("#exam-duration").fill("60");
  await page.getByRole("button", { name: "Create exam" }).click();
  await page.waitForURL((url) => url.pathname.match(/\/staff\/exams\/[0-9a-f-]+$/) !== null, { timeout: 60_000 });

  // The exam page shows draft status and has no questions.
  await expect(page.getByText("Draft").first()).toBeVisible();
  await expect(page.getByText("No questions yet.")).toBeVisible();

  // Add the seeded question.
  const questionSelect = page.locator("#add-question");
  await expect(questionSelect).toBeVisible({ timeout: 30_000 });
  await questionSelect.click();
  const match = page.getByRole("option", { name: new RegExp(seed.questionTitle) });
  await expect(match, "the seeded question appears in the dropdown").toBeVisible();
  await match.click();
  await page.locator("#add-marks").fill("15");
  await page.getByRole("button", { name: "Add question" }).click();
  await expect(page.getByText(seed.questionTitle).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("15").first()).toBeVisible();

  // Publish.
  await page.getByRole("button", { name: "Publish exam" }).click();
  await expect(page.getByText("Published").first()).toBeVisible({ timeout: 60_000 });

  // Assign to the seeded batch.
  // Batches are ticked as tiles; the window defaults to the exam's own.
  // A page that loads while the administrator's request budget is spent shows "rate limit exceeded"; reload until it renders.
  const batchTiles = page.getByRole("group", { name: /batch/i });
  await expect(async () => {
    if (!(await batchTiles.isVisible())) await page.reload();
    await expect(batchTiles).toBeVisible({ timeout: 8_000 });
  }).toPass({ timeout: 90_000 });
  await batchTiles.getByRole("button").first().click();
  await page.getByRole("button", { name: "Assign to 1 selected" }).click();
  await expect(page.getByText("Batch").first()).toBeVisible({ timeout: 30_000 });

  // The exam appears in the staff exam list.
  await expect(async () => {
    await page.goto("/staff/exams");
    await expect(page.getByText(title).first()).toBeVisible({ timeout: 8_000 });
  }).toPass({ timeout: 90_000 });
});
