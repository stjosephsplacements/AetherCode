import type { Metadata } from "next";

export const metadata: Metadata = { title: "Help" };

type Entry = { question: string; answer: React.ReactNode };

const code = "rounded bg-hover px-1.5 py-0.5 font-mono text-[13px] text-ink";

const SECTIONS: { title: string; entries: Entry[] }[] = [
  {
    title: "During an exam",
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

export default function HelpPage() {
  return (
    <div className="mx-auto max-w-[720px] animate-enter">
      <h1 className="display text-[2.25rem] text-ink">Help</h1>
      <p className="mt-2 text-[15px] text-ink-muted">Answers to what students ask most during exams. For anything else, ask your invigilator.</p>
      {SECTIONS.map((section) => (
        <section key={section.title} className="mt-10">
          <h2 className="mb-3 text-sm font-medium text-ink-muted">{section.title}</h2>
          <div className="overflow-hidden rounded-[var(--radius-surface)] border border-line bg-surface">
            {section.entries.map((entry, index) => (
              <details key={entry.question} className={index > 0 ? "group border-t border-line" : "group"}>
                <summary className="cursor-pointer list-none px-5 py-3.5 text-[15px] font-medium text-ink transition-colors hover:bg-hover">{entry.question}</summary>
                <div className="px-5 pb-4 text-sm leading-relaxed text-ink-muted">{entry.answer}</div>
              </details>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
