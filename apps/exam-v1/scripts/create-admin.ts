import { sql } from "../lib/db.ts";
import { generatePassword, hashPassword } from "../lib/password.ts";

const [username, ...nameParts] = process.argv.slice(2);
if (!username) {
  console.error("usage: pnpm create-admin <username> [display name]");
  process.exit(1);
}
const password = generatePassword(14);
await sql`
  INSERT INTO users (username, name, role, password_hash)
  VALUES (${username}, ${nameParts.join(" ") || "Administrator"}, 'admin', ${await hashPassword(password)})
  ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = 'admin', disabled = false`;
console.log(`admin "${username}" password: ${password}`);
await sql.end();
