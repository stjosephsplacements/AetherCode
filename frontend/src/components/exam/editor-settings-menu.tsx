"use client";

import { Settings2 } from "lucide-react";
import { Popover, Switch } from "radix-ui";
import { cn } from "@/lib/utils";
import { type EditorSettings, updateEditorSettings, useEditorSettings } from "./editor-settings";

const FONT_SIZES: EditorSettings["fontSize"][] = [12, 14, 16, 18, 20];
const TAB_SIZES: EditorSettings["tabSize"][] = [2, 4, 8];
const THEMES: { value: EditorSettings["theme"]; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

export function EditorSettingsMenu() {
  const settings = useEditorSettings();
  return (
    <Popover.Root>
      <Popover.Trigger
        aria-label="Editor settings"
        className="grid size-8 place-items-center rounded-[var(--radius-control)] text-ink-muted outline-none transition-colors hover:bg-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-brand data-[state=open]:bg-hover"
      >
        <Settings2 className="size-4" strokeWidth={1.75} />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          className="z-50 w-[260px] animate-fade space-y-4 rounded-[var(--radius-control)] border border-line bg-surface p-4 shadow-[var(--shadow-overlay)]"
        >
          <p className="text-[13px] font-semibold text-ink">Editor settings</p>
          <Row label="Font size">
            <Segmented
              options={FONT_SIZES.map((size) => ({ value: size, label: String(size) }))}
              value={settings.fontSize}
              onChange={(fontSize) => updateEditorSettings({ fontSize })}
            />
          </Row>
          <Row label="Tab size">
            <Segmented options={TAB_SIZES.map((size) => ({ value: size, label: String(size) }))} value={settings.tabSize} onChange={(tabSize) => updateEditorSettings({ tabSize })} />
          </Row>
          <Row label="Theme">
            <Segmented options={THEMES} value={settings.theme} onChange={(theme) => updateEditorSettings({ theme })} />
          </Row>
          <label className="flex items-center justify-between gap-3 text-[13px] text-ink">
            Autocomplete
            <Switch.Root
              checked={settings.autocomplete}
              onCheckedChange={(autocomplete) => updateEditorSettings({ autocomplete })}
              className="relative h-5 w-9 rounded-full bg-line-strong outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand data-[state=checked]:bg-brand"
            >
              <Switch.Thumb className="block size-4 translate-x-0.5 rounded-full bg-surface shadow-[var(--shadow-hairline)] transition-transform data-[state=checked]:translate-x-[18px]" />
            </Switch.Root>
          </label>
          <p className="border-t border-line pt-3 text-xs leading-relaxed text-ink-muted">
            <Kbd>Ctrl</Kbd> + <Kbd>Enter</Kbd> runs your code. Add <Kbd>Shift</Kbd> to submit.
          </p>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs text-ink-muted">{label}</p>
      {children}
    </div>
  );
}

function Segmented<T extends string | number>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex rounded-[var(--radius-control)] bg-hover p-0.5" role="radiogroup">
      {options.map((option) => (
        <button
          key={option.value}
          role="radio"
          aria-checked={option.value === value}
          onClick={() => onChange(option.value)}
          className={cn(
            "h-7 flex-1 rounded-[8px] text-xs font-medium tabular-nums transition-colors",
            option.value === value ? "bg-surface text-ink shadow-[var(--shadow-hairline)]" : "text-ink-muted hover:text-ink",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded border border-line bg-canvas px-1 py-px font-mono text-[11px] text-ink">{children}</kbd>;
}
