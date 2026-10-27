import type { Metadata } from "next";
import Link from "next/link";
import { DocumentPage } from "@/components/site/document";
import { contacts } from "@/lib/server/contacts";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: "Privacy policy",
  description: "What AetherCode collects during exams and practice, why, how long it is kept and how to exercise your rights.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  const { grievance } = contacts();
  const contact = grievance ? (
    <a href={`mailto:${grievance}`}>{grievance}</a>
  ) : (
    "your college's exam administrator"
  );

  return (
    <DocumentPage
      title="Privacy policy"
      updated={SITE.legalUpdated}
      intro={
        <p>
          AetherCode runs coding exams and practice for colleges. This page explains, in plain words, what we collect, why we
          need it, who can see it and how long we keep it. It is written to meet India&apos;s Digital Personal Data Protection Act,
          2023 (DPDP Act), the EU GDPR and, for US institutions, FERPA.
        </p>
      }
      sections={[
        {
          id: "who",
          title: "Who is responsible",
          body: (
            <>
              <p>
                The data fiduciary (the &quot;controller&quot; under the GDPR) for this deployment is <strong>{SITE.operator}</strong>. Your
                college creates your account and decides which exams you take; it acts together with us for the exam records it
                asks us to keep.
              </p>
              <p>AetherCode is open-source software. Colleges that host their own copy are responsible for their own deployment.</p>
            </>
          ),
        },
        {
          id: "collect",
          title: "What we collect",
          body: (
            <>
              <h3>From your college</h3>
              <ul>
                <li>Your name, roll number, college email, department and batch, so you can sign in and see the right exams.</li>
              </ul>
              <h3>When you take an exam or practise</h3>
              <ul>
                <li>The code you write and every version saved while you type, the answers you choose, your submissions and results.</li>
                <li>When you started and finished, and any time staff added.</li>
              </ul>
              <h3>Exam integrity signals</h3>
              <ul>
                <li>When you switch tabs or leave the exam window, leave fullscreen, or try to paste text that wasn&apos;t copied in the editor.</li>
                <li>For labs that require it, the network address your exam comes from and whether Safe Exam Browser is in use.</li>
              </ul>
              <h3>To keep your account safe</h3>
              <ul>
                <li>Your IP address and browser at sign-in, so we can spot sign-ins that aren&apos;t you.</li>
              </ul>
              <h3>What we never collect</h3>
              <p>
                AetherCode does <strong>not</strong> use your camera or microphone, record your screen, log keystrokes outside the
                code editor, or collect biometric data.
              </p>
            </>
          ),
        },
        {
          id: "why",
          title: "Why we use it",
          body: (
            <table>
              <thead>
                <tr>
                  <th>Purpose</th>
                  <th>Lawful basis</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Running exams and practice, grading code and showing results</td>
                  <td>The education service your college provides (DPDP Act s. 7; GDPR art. 6(1)(b) and (e))</td>
                </tr>
                <tr>
                  <td>Keeping exams fair: integrity signals and similarity checks</td>
                  <td>Your college&apos;s legitimate academic duty (DPDP Act s. 7; GDPR art. 6(1)(e) or (f))</td>
                </tr>
                <tr>
                  <td>Securing accounts and the platform</td>
                  <td>Legitimate interest and legal obligation (GDPR art. 6(1)(c) and (f))</td>
                </tr>
                <tr>
                  <td>Counting page visits</td>
                  <td>Your consent, which you can withdraw any time (DPDP Act s. 6; GDPR art. 6(1)(a))</td>
                </tr>
              </tbody>
            </table>
          ),
        },
        {
          id: "cookies",
          title: "Cookies and local storage",
          body: (
            <>
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Kind</th>
                    <th>What it does</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td><code>ac_access</code>, <code>ac_refresh</code>, <code>ac_viewer</code></td>
                    <td>Essential</td>
                    <td>Keep you signed in. Expire when you sign out or your session ends.</td>
                  </tr>
                  <tr>
                    <td><code>ac_must_change</code></td>
                    <td>Essential</td>
                    <td>Asks you to replace a password staff set for you.</td>
                  </tr>
                  <tr>
                    <td><code>aether-consent</code> (local storage)</td>
                    <td>Essential</td>
                    <td>Remembers your cookie choice.</td>
                  </tr>
                  <tr>
                    <td><code>aether-theme</code>, editor settings</td>
                    <td>Functional</td>
                    <td>Remember your theme and editor preferences. Only with your consent.</td>
                  </tr>
                  <tr>
                    <td>Google Analytics (<code>_ga</code>), Umami</td>
                    <td>Analytics</td>
                    <td>Count visits. Only with your consent. Exam and student IDs are removed from page addresses first.</td>
                  </tr>
                </tbody>
              </table>
              <p>
                Change your choice any time with <strong>Cookie settings</strong> in the footer.
              </p>
            </>
          ),
        },
        {
          id: "sharing",
          title: "Who can see your data",
          body: (
            <ul>
              <li>Staff of your college, limited by their role: faculty see their department, mentors see their batches.</li>
              <li>The people who run this deployment, only to keep it working and secure.</li>
              <li>Google, only for visit counts, and only if you allow analytics.</li>
            </ul>
          ),
        },
        {
          id: "storage",
          title: "Where it is stored and how it is protected",
          body: (
            <>
              <p>
                AetherCode is self-hosted: your data stays on servers this deployment&apos;s operator runs, not with the open-source
                maintainers. Each college&apos;s data is kept apart by database row-level security, connections between services are
                encrypted, and your code runs in an isolated sandbox with no network access.
              </p>
              <p>
                Read more on the <Link href="/security">security page</Link>.
              </p>
            </>
          ),
        },
        {
          id: "retention",
          title: "How long we keep it",
          body: (
            <ul>
              <li>Raw code-execution data in the judge: deleted after 30 days.</li>
              <li>Staff audit log of administrative actions: 400 days.</li>
              <li>Exam answers, submissions and results: as long as your college&apos;s academic record policy requires.</li>
              <li>Your account: until your college removes it, or we act on a deletion request.</li>
            </ul>
          ),
        },
        {
          id: "rights",
          title: "Your rights",
          body: (
            <>
              <p>You can ask to:</p>
              <ul>
                <li>get a copy of the data we hold about you,</li>
                <li>correct data that is wrong,</li>
                <li>delete your data, subject to records your college must keep by law,</li>
                <li>withdraw consent for analytics at any time,</li>
                <li>name someone to act for you if you cannot (DPDP Act s. 14).</li>
              </ul>
              <p>
                Send a request to {contact}. If you are not satisfied with the answer, you can complain to the Data Protection Board
                of India or, in the EU, your data protection authority. At US institutions, FERPA rights over education records are
                exercised through your college.
              </p>
            </>
          ),
        },
        {
          id: "children",
          title: "Students under 18",
          body: (
            <p>
              AetherCode is meant for college students. If your college enrols a student under 18, it must get verifiable consent from
              a parent or guardian first, as the DPDP Act requires. AetherCode shows no ads to anyone.
            </p>
          ),
        },
        {
          id: "contact",
          title: "Grievance officer and contact",
          body: (
            <p>
              Questions or complaints about your data: {contact}. Security issues go through the{" "}
              <Link href="/security">security page</Link>.
            </p>
          ),
        },
        {
          id: "changes",
          title: "Changes to this policy",
          body: <p>When this policy changes, the date at the top changes with it. Earlier versions are in the project&apos;s public history on GitHub.</p>,
        },
      ]}
    />
  );
}
