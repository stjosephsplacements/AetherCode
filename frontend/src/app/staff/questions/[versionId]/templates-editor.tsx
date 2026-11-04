"use client";

import { CircleNotch, CodeBlock } from "@phosphor-icons/react/ssr";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { FormMessage } from "@/components/staff/form";
import { LanguageLabel } from "@/components/language-icon";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { type CodeTemplates, saveTemplates } from "../actions";

const area = "min-h-[140px] w-full resize-y rounded-[var(--radius-control)] border border-line bg-surface p-3 font-mono text-xs leading-relaxed text-ink outline-none placeholder:text-ink-subtle focus:border-brand focus:ring-4 focus:ring-brand/15";

/**
 * Function-only questions: per language, the stub the student starts from, and the code that wraps their
 * function (before and after it). Students never see the wrapper. Without a wrapper a language is a
 * whole-program question as before.
 */
export function TemplatesEditor({ versionId, languages, initial }: { versionId: string; languages: string[]; initial: CodeTemplates }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [templates, setTemplates] = useState<CodeTemplates>(initial);
  const [language, setLanguage] = useState(languages[0] ?? "");
  const [state, setState] = useState<{ error: string | null; message?: string | null }>({ error: null });
  const [pending, startTransition] = useTransition();
  const current = templates[language] ?? { starter: "", prefix: "", suffix: "" };
  const set = (patch: Partial<typeof current>) => setTemplates((all) => ({ ...all, [language]: { ...current, ...patch } }));
  const configured = Object.values(initial).filter((template) => template.starter.trim()).length;

  function save() {
    startTransition(async () => {
      const kept = Object.fromEntries(Object.entries(templates).filter(([, template]) => template.starter.trim() || template.prefix || template.suffix));
      const result = await saveTemplates(versionId, kept);
      setState(result);
      if (!result.error) {
        setOpen(false);
        router.refresh();
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm">
          <CodeBlock />
          {configured ? `Function stubs (${configured})` : "Function stubs"}
        </Button>
      </DialogTrigger>
      <DialogContent title="Function stubs" description="Students write only the function. Their code runs between the two wrapper parts, which they never see." className="w-[min(94vw,820px)]">
        <div className="min-h-0 space-y-4 overflow-y-auto p-6">
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Language">
            {languages.map((key) => {
              const done = Boolean(templates[key]?.starter.trim());
              return (
                <button key={key} role="tab" aria-selected={language === key} type="button" onClick={() => setLanguage(key)} className={cn("inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors", language === key ? "bg-brand-soft text-brand-soft-ink" : "bg-hover text-ink-muted hover:text-ink")}>
                  <LanguageLabel language={key} />
                  {done && <span className="size-1.5 rounded-full bg-success" aria-label="has a stub" />}
                </button>
              );
            })}
          </div>
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium text-ink">Stub the student sees</span>
            <textarea className={area} spellCheck={false} value={current.starter} onChange={(event) => set({ starter: event.target.value })} placeholder={"def two_sum(nums, target):\n    # write your code here\n    pass\n"} />
          </label>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-medium text-ink">Hidden code before their function</span>
              <textarea className={area} spellCheck={false} value={current.prefix} onChange={(event) => set({ prefix: event.target.value })} placeholder={"#include <stdio.h>\n"} />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-medium text-ink">Hidden code after it (reads input, calls it, prints)</span>
              <textarea className={area} spellCheck={false} value={current.suffix} onChange={(event) => set({ suffix: event.target.value })} placeholder={"\nn, t = map(int, input().split())\nprint(two_sum(...))\n"} />
            </label>
          </div>
          <p className="text-[12.5px] text-ink-muted">Run, submit and the model check send the student&apos;s code as: before + their code + after. Leave both hidden parts empty for a language to keep it a whole-program question.</p>
          <div className="flex items-center justify-between gap-3">
            <FormMessage state={state} />
            <Button onClick={save} disabled={pending} className="ml-auto">
              {pending && <CircleNotch className="animate-spin" />}
              Save stubs
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
