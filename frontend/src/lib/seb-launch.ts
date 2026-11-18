// One-click launch: Safe Exam Browser registers sebs:// (and seb:// for plain http) and fetches
// the same host and path over https (or http) as a launch file. A one-time ticket in the query
// stands in for the login cookie, which SEB does not have.

const UUID = "[0-9a-fA-F-]{36}";
const LAUNCH_FILE = new RegExp(`^/api/seb/v1/tenants/${UUID}/exams/${UUID}/launch-file$`);
const TICKET = /^[A-Za-z0-9_-]{43}$/;

export function sebLaunchURL(origin: string, tenantID: string, examID: string, ticket: string): string {
  const { protocol, host } = new URL(origin);
  const scheme = protocol === "https:" ? "sebs" : "seb";
  return `${scheme}://${host}/api/seb/v1/tenants/${tenantID}/exams/${examID}/launch-file?ticket=${encodeURIComponent(ticket)}`;
}

// A ticketed launch-file fetch is forwarded without a bearer; the gateway and SEB service check the ticket.
export function isTicketedLaunchFile(method: string, pathname: string, search: string): boolean {
  return method === "GET" && LAUNCH_FILE.test(pathname) && TICKET.test(new URLSearchParams(search).get("ticket") ?? "");
}

// Safe Exam Browser sends HEAD before it downloads. The gateway only admits GET here, so a HEAD that reached it would fail
// and make SEB fall back to probing with a GET, which starts the ticket's re-download window early. A HEAD for a well-formed
// link is therefore answered here, without looking at the ticket, so it stays unchanged until SEB's real GET.
export function isLaunchFileProbe(method: string, pathname: string, search: string): boolean {
  return method === "HEAD" && isTicketedLaunchFile("GET", pathname, search);
}
