import type { ReactNode } from "react";
import { SITE } from "@/lib/site";

export type HelpEntry = { question: string; answer: ReactNode };
export type HelpSection = { title: string; audience: "students" | "staff"; entries: HelpEntry[] };

const code = "rounded bg-hover px-1.5 py-0.5 font-mono text-[13px] text-ink";

export const STUDENT_HELP: HelpSection[] = [
  {
    title: "During an exam",
    audience: "students",
    entries: [
      {
        question: "Is my code saved if my browser closes or the laptop restarts?",
        answer: "Yes. Your code saves as you type, and your choices save the moment you pick them. Sign in again and open the exam: everything is where you left it.",
      },
      {
        question: "Does the timer stop while I am away?",
        answer: "No. The timer is kept by the server and runs from the moment you press Start. If you lose time because of a problem in the lab, tell your invigilator; they can add time.",
      },
      {
        question: "What is the difference between Run code and Submit code?",
        answer:
          "Run code checks your program on the sample tests and shows their input, expected and actual output. Submit code evaluates it on every test, hidden ones included, and only shows how many passed. Each question counts your best submission, so submitting broken code later cannot lower your score.",
      },
      {
        question: "What happens when time runs out?",
        answer: "The code you saved last for each question is handed in and graded automatically. You do not need to press anything.",
      },
      {
        question: "I see a warning that I left the exam window.",
        answer:
          "Switching to another window, opening another tab, leaving fullscreen or pasting text from outside the exam is recorded and shown to your invigilator. Stay on the exam screen until you have ended the test.",
      },
      {
        question: "Run or Submit says the judge is busy or could not evaluate my code.",
        answer:
          "Wait 10 to 15 seconds and try again; many students may be submitting at once. Your code is safe either way. If it keeps failing for more than a few minutes, tell your invigilator.",
      },
    ],
  },
  {
    title: "Safe Exam Browser",
    audience: "students",
    entries: [
      {
        question: "The exam asks me to open it in Safe Exam Browser.",
        answer: "Your exam is locked to the lab's Safe Exam Browser. On the exam page, download the launch file and open it; Safe Exam Browser starts the exam for you.",
      },
      {
        question: "Safe Exam Browser shows a blank white screen.",
        answer: (
          <>
            Press <span className={code}>Ctrl + R</span> (<span className={code}>Cmd + R</span> on a Mac) to reload. If it stays blank, ask your invigilator to help you quit and reopen it, and check your network connection.
          </>
        ),
      },
      {
        question: "Safe Exam Browser asks for a quit password.",
        answer: "Ask your invigilator. The password is kept by the invigilators so that nobody can leave the locked exam on their own.",
      },
      {
        question: "Safe Exam Browser says a virtual machine was detected, or does not load on an old Mac.",
        answer: "Download the latest launch file from the exam page and open it again. If it still fails, tell your invigilator; they can move you to a lab machine.",
      },
    ],
  },
  {
    title: "Writing your solution",
    audience: "students",
    entries: [
      {
        question: "Java: \"class not found\" or a public class error.",
        answer: (
          <>
            All your code goes into one file, <span className={code}>Main.java</span>. Only <span className={code}>public class Main</span> may be public; remove{" "}
            <span className={code}>public</span> from any other class, or make it a <span className={code}>static class</span> inside <span className={code}>Main</span>.
          </>
        ),
      },
      {
        question: "Java: \"non-static variable this cannot be referenced from a static context\".",
        answer: (
          <>
            A helper class written inside <span className={code}>Main</span> must be <span className={code}>static class Node</span>, because{" "}
            <span className={code}>main</span> is static.
          </>
        ),
      },
      {
        question: "Java: NoSuchElementException while reading input.",
        answer: (
          <>
            Your program reads more values than the input has. Check your loop bounds against the input format, and after{" "}
            <span className={code}>nextInt()</span> call <span className={code}>nextLine()</span> once before reading a whole line.
          </>
        ),
      },
      {
        question: "Python: my program waits forever or fails on input.",
        answer: (
          <>
            Read exactly what the statement describes, for example <span className={code}>a, b = map(int, input().split())</span>. For large input,{" "}
            <span className={code}>import sys</span> and read with <span className={code}>sys.stdin</span>.
          </>
        ),
      },
      {
        question: "C and C++: my output is right on my laptop but wrong here.",
        answer: (
          <>
            Print exactly the format asked, with a newline at the end, and nothing else (no prompts like &ldquo;Enter n:&rdquo;). Use <span className={code}>long long</span> when
            values can exceed about two billion. <span className={code}>main</span> must return 0.
          </>
        ),
      },
      {
        question: "Multiple choice: how are these marked?",
        answer: "You get the marks only when your selection is exactly right; there are no part marks. Click a chosen option again to clear it.",
      },
    ],
  },
];

/** Extra answers for the public help center: setup, languages and staff tasks. */
export const MORE_HELP: HelpSection[] = [
  {
    title: "Before your exam",
    audience: "students",
    entries: [
      {
        question: "Which browsers work?",
        answer: "A current version of Chrome, Edge, Firefox or Safari. If your exam needs Safe Exam Browser, install the version your college gives you before exam day.",
      },
      {
        question: "How do I check my laptop and network are ready?",
        answer: (
          <>
            Open the <a className="text-ink underline underline-offset-2" href="/system-check">system check</a>. It tests your browser, connection to AetherCode and fullscreen support in a few seconds.
          </>
        ),
      },
      {
        question: "My internet dropped during the exam. Is my code lost?",
        answer: "No. A banner tells you you're offline and your code is kept on your device. As soon as you're back online it saves to the server again. The timer keeps running on the server, so tell your invigilator if you lost time.",
      },
    ],
  },
  {
    title: "Languages",
    audience: "students",
    entries: [
      {
        question: "Which languages can I use?",
        answer: `${SITE.languages.join(", ")}. Your exam may allow only some of them; the language menu in the editor shows which.`,
      },
      {
        question: "How is my code scored?",
        answer: "Each test case is worth fixed points and is either fully passed or not. Your program must finish within the time and memory limits shown on the question. Each question keeps your best submission.",
      },
    ],
  },
  {
    title: "For staff",
    audience: "staff",
    entries: [
      {
        question: "A student lost time because of a lab problem. Can I give them more?",
        answer: "Yes. Open the exam's live monitor and add time to that student. Their timer updates on the server straight away.",
      },
      {
        question: "A student forgot their password.",
        answer: "Open the student under Students and reset their password. They'll be asked to set a new one when they sign in.",
      },
      {
        question: "How do I get results out?",
        answer: "Open the exam's results and use Export CSV. Scores, statuses and submission times are included.",
      },
    ],
  },
];
