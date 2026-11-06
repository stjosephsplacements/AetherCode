// Staff write a multiple-choice question through the three-step wizard and find it in the question list.
import { expect, test } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { setUp } from "./seed";
import { adminEmail, adminPassword, adminTotpSecret, dismissOnboarding, freshTotp } from "./support";

const run = randomBytes(3).toString("hex").toUpperCase();

test("staff create a multiple-choice question in the wizard", async ({ page }) => {
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

  const title = `UI prime ${run}`;
  await page.goto("/staff/questions/new");
  await page.getByRole("radio", { name: /Multiple choice/ }).check();
  await page.getByRole("textbox", { name: "Title" }).fill(title);
  await page.getByRole("textbox", { name: "Statement" }).fill("Which of these numbers is prime?");
  // Step 1 refuses to continue without a category.
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Choose a category, or add one.")).toBeVisible();
  await page.getByRole("combobox", { name: "Category" }).click();
  await page.getByRole("option", { name: "Uncategorised" }).click();
  await page.getByRole("button", { name: "Continue" }).click();

  // Step 2: options and the answer key. Two options are the minimum and none may be empty.
  await expect(page.getByRole("heading", { name: "Options and the correct answer" })).toBeVisible();
  for (const [index, text] of ["4", "6", "7", "9"].entries()) await page.getByRole("textbox", { name: `Option ${index + 1}`, exact: true }).fill(text);
  await page.getByRole("textbox", { name: "Explanation for option 3" }).fill("7 has no divisors but 1 and itself.");
  await page.getByRole("checkbox", { name: "Option 3 is correct" }).check();
  await page.getByRole("button", { name: "Continue" }).click();

  // Step 3: review and save.
  await page.getByRole("button", { name: /^Save/ }).click();
  await page.waitForURL((url) => url.pathname.startsWith("/staff/questions") && url.pathname !== "/staff/questions/new", { timeout: 60_000 });

  await page.goto("/staff/questions");
  await page.getByRole("searchbox").first().fill(title).catch(() => {});
  await expect(page.getByText(title).first()).toBeVisible({ timeout: 30_000 });
});
