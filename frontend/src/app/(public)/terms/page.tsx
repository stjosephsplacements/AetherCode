import type { Metadata } from "next";
import Link from "next/link";
import { DocumentPage } from "@/components/site/document";
import { contacts } from "@/lib/server/contacts";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: "Terms of use",
  description: "The rules for using AetherCode: exam integrity, who owns your code, acceptable use and account suspension.",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  const { support } = contacts();
  return (
    <DocumentPage
      title="Terms of use"
      updated={SITE.legalUpdated}
      intro={
        <p>
          These terms apply to everyone who uses this AetherCode deployment: students, faculty and administrators. By signing in
          you agree to them, to your college&apos;s exam rules, and to our <Link href="/privacy">privacy policy</Link>.
        </p>
      }
      sections={[
        {
          id: "service",
          title: "The service",
          body: (
            <p>
              AetherCode is provided by {SITE.operator} to run coding exams, practice and placement preparation for colleges. Your
              college decides who gets an account and which exams you take.
            </p>
          ),
        },
        {
          id: "account",
          title: "Your account",
          body: (
            <ul>
              <li>Your account is for you alone. Don&apos;t share your password or let anyone sign in as you.</li>
              <li>If staff give you a password, you&apos;ll be asked to replace it the first time you sign in.</li>
              <li>Tell your exam administrator straight away if you think someone else has used your account.</li>
            </ul>
          ),
        },
        {
          id: "integrity",
          title: "Exam integrity",
          body: (
            <>
              <p>During an exam, unless your college says otherwise in writing:</p>
              <ul>
                <li>Work alone. Don&apos;t talk to, message or share code with anyone.</li>
                <li>Don&apos;t use AI assistants, code generators or solutions from the internet.</li>
                <li>Don&apos;t share your screen, take photos of questions, or copy questions out of the exam.</li>
                <li>Stay in the exam window. Switching tabs, leaving fullscreen and pasting from outside the editor are recorded.</li>
                <li>If your exam needs Safe Exam Browser, use it for the whole exam.</li>
              </ul>
              <p>
                Similar submissions are compared after the exam. Your college, not AetherCode, decides what happens if a rule is
                broken; that can include a zero for the exam.
              </p>
            </>
          ),
        },
        {
          id: "your-code",
          title: "Who owns your code",
          body: (
            <>
              <p>
                <strong>You own the code you write.</strong> To run the service you give the operator and your college permission
                to store it, run it against tests, grade it, show it to the staff who assess you, and compare it with other
                submissions to check for copying. That permission covers nothing else and ends when your data is deleted.
              </p>
              <p>
                Questions, test cases and editorials belong to whoever wrote them, usually your college. Don&apos;t copy or publish
                them without permission.
              </p>
            </>
          ),
        },
        {
          id: "acceptable-use",
          title: "Acceptable use",
          body: (
            <>
              <p>Don&apos;t:</p>
              <ul>
                <li>try to read hidden test cases, other students&apos; code or data you weren&apos;t given,</li>
                <li>submit code meant to escape the sandbox, attack other systems, mine cryptocurrency or exhaust resources,</li>
                <li>tamper with the timer, integrity checks or Safe Exam Browser,</li>
                <li>automate requests to get around the rate limits that protect sign-in and code execution.</li>
              </ul>
              <p>
                AetherCode&apos;s source code is open under the {SITE.license}: you&apos;re free to read, study and modify it. Finding a
                weakness in this deployment? Report it through the <Link href="/security">security page</Link>; good-faith
                reports are welcome.
              </p>
            </>
          ),
        },
        {
          id: "suspension",
          title: "Suspending accounts",
          body: (
            <p>
              We or your college may suspend an account that breaks these terms, puts other users or the service at risk, or when
              your college asks us to. Where it is safe to do so, we&apos;ll tell you why and how to ask for a review.
            </p>
          ),
        },
        {
          id: "availability",
          title: "Availability and liability",
          body: (
            <>
              <p>
                We work to keep AetherCode running during exams, and current service health is on the{" "}
                <Link href="/status">status page</Link>. If a problem stops you finishing an exam, tell your invigilator: staff can
                add time or reschedule.
              </p>
              <p>
                The software is provided &quot;as is&quot;, without warranty, as the {SITE.license} states. To the extent the law
                allows, the operator is not liable for indirect losses arising from using the service.
              </p>
            </>
          ),
        },
        {
          id: "law",
          title: "Governing law",
          body: <p>These terms are governed by the laws of India.</p>,
        },
        {
          id: "contact",
          title: "Contact",
          body: (
            <p>
              Questions about these terms: {support ? <a href={`mailto:${support}`}>{support}</a> : "your college's exam administrator"}.
            </p>
          ),
        },
      ]}
    />
  );
}
