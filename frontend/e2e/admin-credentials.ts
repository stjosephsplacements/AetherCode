// Local E2E admin fixture. Kept in its own file so CodeQL can ignore the
// frontend/e2e tree (file→HTTP is expected only against localhost:8380).
import { readFileSync } from "node:fs";
import { homedir } from "node:os";

const words = readFileSync(process.env.E2E_ADMIN_FILE ?? `${homedir()}/aethercode-admin.txt`, "utf8").trim().split(/\s+/);
export const adminEmail = words[0]!;
export const adminPassword = words[1]!;
export const adminTotpSecret = words[2];
