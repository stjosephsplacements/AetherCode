"use client";

import { Keyboard, Scale } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Dialog, DialogContent, SheetContent } from "@/components/ui/dialog";
import { SITE } from "@/lib/site";

const isMac = () => /Mac|iPhone|iPad/.test(navigator.platform);
const useIsMac = () => useSyncExternalStore(() => () => {}, isMac, () => false);

/** Only shortcuts that work: ours from code-editor.tsx, the rest Monaco's defaults. */
function shortcuts(mod: string) {
  return [
    {
      group: "Exam",
      keys: [
        [`${mod} Enter`, "Run code on the sample tests"],
        [`${mod} Shift Enter`, "Submit code"],
        ["?", "Show this list (outside the editor)"],
      ],
    },
    {
      group: "Editing",
      keys: [
        [`${mod} /`, "Comment or uncomment lines"],
        [`${mod} D`, "Select the next match"],
        ["Alt ↑ / ↓", "Move the line up or down"],
        ["Shift Alt ↓", "Copy the line down"],
        ["Tab / Shift Tab", "Indent or outdent"],
        [`${mod} Z / ${mod} Shift Z`, "Undo or redo"],
      ],
    },
    {
      group: "Finding",
      keys: [
        [`${mod} F`, "Find"],
        [`${mod} H`, "Replace"],
        [`${mod} G`, "Go to line"],
        ["F1", "All editor commands"],
      ],
    },
  ] as const;
}

/** Header buttons for the shortcut cheatsheet and the scoring explainer. */
export function ExamGuides() {
  const [keysOpen, setKeysOpen] = useState(false);
  const [scoringOpen, setScoringOpen] = useState(false);
  const mac = useIsMac();
  const mod = mac ? "⌘" : "Ctrl";

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "?" || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      // Typing "?" in code or an input must stay a question mark.
      if (target && (target.closest(".monaco-editor") || target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      event.preventDefault();
      setKeysOpen(true);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const button = "grid size-8 place-items-center rounded-full text-ink-muted transition-colors hover:bg-hover hover:text-ink";

  return (
    <>
      <button type="button" aria-label="How scoring works" title="How scoring works" onClick={() => setScoringOpen(true)} className={button}>
        <Scale className="size-4" strokeWidth={1.75} />
      </button>
      <button type="button" aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)" onClick={() => setKeysOpen(true)} className={button}>
        <Keyboard className="size-4" strokeWidth={1.75} />
      </button>

      <Dialog open={keysOpen} onOpenChange={setKeysOpen}>
        <DialogContent title="Keyboard shortcuts" description="Press ? any time outside the editor to see these again.">
          <div className="grid gap-8 overflow-y-auto px-6 py-5 sm:grid-cols-2">
            {shortcuts(mod).map((section) => (
              <section key={section.group} className={section.group === "Editing" ? "sm:row-span-2" : undefined}>
                <h3 className="text-[13px] font-medium text-ink-muted">{section.group}</h3>
                <dl className="mt-2 space-y-2">
                  {section.keys.map(([combo, action]) => (
                    <div key={combo} className="flex items-center justify-between gap-4">
                      <dt className="text-[14px] text-ink">{action}</dt>
                      <dd className="flex shrink-0 gap-1">
                        {combo.split(" ").map((key, index) => (
                          <kbd key={`${key}-${index}`} className="min-w-6 rounded-md border border-line-strong bg-surface-2 px-1.5 py-0.5 text-center font-mono text-[12px] text-ink">
                            {key}
                          </kbd>
                        ))}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={scoringOpen} onOpenChange={setScoringOpen}>
        <SheetContent title="How scoring works" description="What happens when you run and submit code.">
          <div className="prose-doc px-6 py-5">
            <h3>Run vs Submit</h3>
            <p>
              <strong>Run</strong> checks your code against the sample tests and shows their input, expected output and yours.{" "}
              <strong>Submit</strong> checks it against every test, hidden ones included, and shows only how many passed.
            </p>
            <h3>Hidden tests</h3>
            <p>
              Hidden tests decide your marks. You never see their input or expected output, so test edge cases yourself: empty input,
              one element, the largest values allowed.
            </p>
            <h3>Points</h3>
            <p>
              Each test is worth set points, and harder tests can be worth more. A test either passes fully or scores nothing. Each
              question keeps your best submission, so a later broken one can&apos;t lower your score.
            </p>
            <h3>Time and memory limits</h3>
            <p>
              Each question shows its limits under the title. The time limit is per test: if one test runs longer, that test fails
              with <em>Time limit exceeded</em>. Going over the memory limit fails it with <em>Memory limit exceeded</em>.
            </p>
            <h3>What the results mean</h3>
            <table>
              <tbody>
                <tr><th>Passed</th><td>Your output matched.</td></tr>
                <tr><th>Wrong answer</th><td>It ran, but the output was different. Check spacing and new lines too.</td></tr>
                <tr><th>Runtime error</th><td>Your program crashed, for example dividing by zero or reading past an array.</td></tr>
                <tr><th>Compilation error</th><td>The code didn&apos;t compile. Run shows the compiler&apos;s message.</td></tr>
                <tr><th>Judge error</th><td>Our side had a problem. Run or submit again.</td></tr>
              </tbody>
            </table>
            <h3>Languages</h3>
            <p>{SITE.languages.join(", ")}. Your exam may allow only some of them.</p>
          </div>
        </SheetContent>
      </Dialog>
    </>
  );
}
