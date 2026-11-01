export type StaffLine = { username: string; name: string; email: string };

export const MAX_STAFF_ROWS = 200;
const USERNAME = /^[a-z0-9._-]{3,64}$/;

/**
 * Reads pasted or uploaded staff: one per line as `username, full name, email`, the email
 * optional. A header row is skipped. Anything wrong is reported by line so it can be fixed.
 */
export function parseStaffLines(text: string): { rows: StaffLine[]; problems: string[] } {
  const rows: StaffLine[] = [];
  const problems: string[] = [];
  const seen = new Set<string>();
  const lines = text.split(/\r?\n/);
  lines.forEach((raw, index) => {
    const line = raw.trim();
    if (!line) return;
    const [username = "", name = "", email = ""] = line.split(",").map((part) => part.trim().replace(/^"|"$/g, ""));
    if (index === 0 && /^user(name)?$/i.test(username)) return;
    const key = username.toLowerCase();
    if (!USERNAME.test(key)) return void problems.push(`Line ${index + 1}: "${username}" is not a valid username (3 to 64 letters, digits, dot, dash, underscore).`);
    if (!name) return void problems.push(`Line ${index + 1}: ${username} has no name.`);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return void problems.push(`Line ${index + 1}: "${email}" is not an email address.`);
    if (seen.has(key)) return void problems.push(`Line ${index + 1}: ${username} appears twice.`);
    seen.add(key);
    rows.push({ username: key, name, email });
  });
  if (rows.length > MAX_STAFF_ROWS) problems.push(`At most ${MAX_STAFF_ROWS} staff can be added at once.`);
  return { rows, problems };
}
