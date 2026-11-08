// The staff side of a published exam: its results and similarity pages before anyone has sat it, and the
// live monitor's controls (integrity settings persist, an announcement is sent, extra time is added).
import { expect, test } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { setUp } from "./seed";
import { adminEmail, adminPassword, adminTotpSecret, dismissOnboarding, freshTotp } from "./support";

const run = randomBytes(3).toString("hex").toUpperCase();

test("results, similarity and the live monitor controls", async ({ page }) => {
  test.setTimeout(300_000);
  const seed = await setUp(run, 10_000);
  await page.goto("/login");
  await page.getByLabel("Roll number or username").fill(adminEmail);
  await page.locator("#password").fill(adminPassword);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.locator("#code").fill(await freshTotp(adminTotpSecret!));
  await page.getByRole("button", { name: /verify and sign in/i }).click();
  await page.waitForURL("**/admin");
  await page.goto(`/admin/open?college=${seed.tenant}&next=${encodeURIComponent("/staff")}`);
  await dismissOnboarding(page);
  const exam = `/staff/exams/${seed.examId}`;

  // Nobody has sat the exam: both reports say so instead of showing empty tables or errors.
  await page.goto(`${exam}/results`);
  await expect(page.getByRole("heading", { name: "Results", level: 1 })).toBeVisible();
  await expect(page.getByText("No graded attempts yet.")).toBeVisible();
  await page.goto(`${exam}/similarity`);
  await expect(page.getByRole("heading", { name: "Similarity", level: 1 })).toBeVisible();
  await expect(page.getByText("No code saved yet.")).toBeVisible();

  // The monitor lists the two seeded students as not started.
  await page.goto(`${exam}/monitor`);
  await expect(page.getByRole("heading", { name: "Live monitor", level: 1 })).toBeVisible();
  await expect(page.getByText("Not started").first()).toBeVisible();
  await expect(page.getByRole("cell", { name: seed.roll })).toBeVisible();
  await expect(page.getByRole("cell", { name: seed.roll2 })).toBeVisible();

  // Integrity settings are saved and still there after a reload.
  const fullscreen = page.getByRole("checkbox", { name: "Require fullscreen" });
  await fullscreen.check();
  await page.getByRole("button", { name: "Save integrity settings" }).click();
  await expect(async () => {
    await page.reload();
    await expect(page.getByRole("checkbox", { name: "Require fullscreen" })).toBeChecked({ timeout: 4_000 });
  }).toPass({ timeout: 40_000 });

  // An announcement is accepted and the box clears.
  const message = page.getByRole("textbox", { name: "Message" });
  await message.fill("Please keep your ID cards on the desk.");
  await page.getByRole("button", { name: "Send to everyone" }).click();
  await expect(message).toHaveValue("", { timeout: 30_000 });

  // The results stay hidden until they are released.
  await expect(page.getByText("Hidden. Students see only that they handed in.")).toBeVisible();
});

test("the student roster exports a CSV", async ({ page }) => {
  test.setTimeout(240_000);
  const seed = await setUp(`${run}X`, 10_000);
  await page.goto("/login");
  await page.getByLabel("Roll number or username").fill(adminEmail);
  await page.locator("#password").fill(adminPassword);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.locator("#code").fill(await freshTotp(adminTotpSecret!));
  await page.getByRole("button", { name: /verify and sign in/i }).click();
  await page.waitForURL("**/admin");
  await page.goto(`/admin/open?college=${seed.tenant}&next=${encodeURIComponent("/staff/students")}`);
  await dismissOnboarding(page);
  await page.getByRole("searchbox", { name: "Search students" }).fill(seed.roll);
  await expect(page.getByRole("link", { name: "E2E Student" }).first()).toBeVisible({ timeout: 30_000 });
  const download = page.waitForEvent("download", { timeout: 30_000 });
  await page.getByRole("button", { name: "Export" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.csv$/i);
  const text = (await import("node:fs")).readFileSync(await file.path(), "utf8");
  expect(text).toContain(seed.roll);
  // The "password" column holds a state (set, temporary, none), never a generated password.
  const rows = text.trim().split(/\r?\n/).map((line) => line.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((cell) => cell.replace(/^"|"$/g, "")));
  const column = rows[0]!.map((cell) => cell.toLowerCase()).indexOf("password");
  expect(column, "the roster has a password column").toBeGreaterThanOrEqual(0);
  const values = rows.slice(1).map((row) => row[column] ?? "");
  expect(values.length).toBeGreaterThan(0);
  // A generated password is 12 letters and digits with no spaces; a state label has words and spaces.
  for (const value of values) expect(value, `password column value: ${value}`).not.toMatch(/^[A-Za-z0-9]{12}$/);
});
