import type { Metadata } from "next";
import Link from "next/link";
import { DocumentPage } from "@/components/site/document";
import { contacts } from "@/lib/server/contacts";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: "Security",
  description: "How AetherCode isolates colleges, sandboxes code and protects exams, and how to report a vulnerability.",
  alternates: { canonical: "/security" },
};

export default function SecurityPage() {
  const { security } = contacts();
  return (
    <DocumentPage
      title="Security"
      intro={
        <p>
          Exams only matter if they can be trusted. Here is how AetherCode keeps colleges apart, keeps submitted code contained and
          keeps results honest, and how to tell us if you find a weakness.
        </p>
      }
      sections={[
        {
          id: "report",
          title: "Report a vulnerability",
          body: (
            <>
              <p>
                Report privately through a{" "}
                <a href={SITE.advisories}>GitHub security advisory</a>
                {security ? (
                  <>
                    {" "}or by email to <a href={`mailto:${security}`}>{security}</a>
                  </>
                ) : null}
                . Please don&apos;t open a public issue. Include what you found, how to reproduce it and the impact you expect.
              </p>
              <ul>
                <li>We confirm we&apos;ve received your report and keep you updated while we fix it.</li>
                <li>We credit you in the advisory unless you&apos;d rather stay anonymous.</li>
                <li>There is no paid bug bounty.</li>
              </ul>
              <p>
                Machine-readable details are in <a href="/.well-known/security.txt">/.well-known/security.txt</a>. We don&apos;t
                publish a PGP key; GitHub advisories are private between you and the maintainers.
              </p>
            </>
          ),
        },
        {
          id: "safe-harbor",
          title: "Safe harbor",
          body: (
            <>
              <p>We won&apos;t pursue or support legal action against research done in good faith that:</p>
              <ul>
                <li>uses only your own accounts or a copy you host yourself,</li>
                <li>never reads, changes or keeps other people&apos;s data,</li>
                <li>doesn&apos;t disrupt a live exam or degrade the service,</li>
                <li>gives us reasonable time to fix the issue before you talk about it.</li>
              </ul>
            </>
          ),
        },
        {
          id: "isolation",
          title: "Colleges are kept apart",
          body: (
            <p>
              Every college&apos;s data carries its tenant, and PostgreSQL row-level security enforces the boundary inside the database
              itself, so a bug in application code can&apos;t return another college&apos;s rows. Each service owns its own database and
              connects with a least-privilege role.
            </p>
          ),
        },
        {
          id: "access",
          title: "Access control",
          body: (
            <ul>
              <li>Passwords are hashed with Argon2id. Sessions use short-lived tokens that rotate.</li>
              <li>Roles (administrator, faculty, mentor, placement officer, student) are scoped to a college, department or batch and checked with a Casbin policy on every request.</li>
              <li>Each service presents a signed capability before its database will act, so a compromised service can&apos;t reach data it doesn&apos;t own.</li>
              <li>Staff actions are written to an audit log kept for 400 days.</li>
            </ul>
          ),
        },
        {
          id: "sandbox",
          title: "Submitted code is contained",
          body: (
            <p>
              Code runs in an isolated execution engine with no network access, strict CPU, memory and time limits, and a fresh
              workspace for every run. Hidden test cases never leave the judge: students see how many passed, never their contents.
            </p>
          ),
        },
        {
          id: "network",
          title: "Encrypted everywhere",
          body: (
            <p>
              Browsers reach AetherCode over HTTPS. Services talk to each other over mutual TLS, each with its own certificate and
              identity, so no service can impersonate another.
            </p>
          ),
        },
        {
          id: "exams",
          title: "Exam lockdown",
          body: (
            <p>
              Exams can require Safe Exam Browser; its configuration key is checked on every request, so ordinary browsers are
              refused. Labs can be limited to their own networks. Timers are kept by the server, not the browser. See the{" "}
              <Link href="/architecture">architecture overview</Link> for how the pieces fit.
            </p>
          ),
        },
        {
          id: "supply-chain",
          title: "Supply chain",
          body: (
            <ul>
              <li>Every change runs CodeQL, Go vulnerability scanning and dependency review before it can merge.</li>
              <li>Container images are signed with cosign and ship with a software bill of materials.</li>
              <li>Dependabot keeps dependencies current, and secret scanning blocks credentials from being pushed.</li>
            </ul>
          ),
        },
      ]}
    />
  );
}
