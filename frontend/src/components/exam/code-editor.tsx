"use client";

import Editor, { type Monaco, type OnMount, loader } from "@monaco-editor/react";
import { useEffect, useRef } from "react";
import type { EditorSettings } from "./editor-settings";
import { useTheme } from "@/lib/theme";
import { editorLanguage } from "@/lib/utils";

// Served from public/monaco (scripts/copy-monaco.mjs), never a CDN.
loader.config({ paths: { vs: "/monaco/vs" } });

// Both themes use the page's surface colour so the editor reads as part of
// its panel; colours mirror the tokens in globals.css.
function defineThemes(monaco: Monaco) {
  monaco.editor.defineTheme("aether-light", {
    base: "vs",
    inherit: true,
    rules: [
      { token: "comment", foreground: "8e88a3", fontStyle: "italic" },
      { token: "keyword", foreground: "b34700" },
      { token: "string", foreground: "0f7a4d" },
      { token: "number", foreground: "d6295a" },
      { token: "type", foreground: "4b3fd1" },
    ],
    colors: {
      "editor.background": "#ffffff",
      "editor.lineHighlightBackground": "#f4efe9",
      "editor.lineHighlightBorder": "#00000000",
      "editorLineNumber.foreground": "#c3bccb",
      "editorLineNumber.activeForeground": "#5d5878",
      "editorCursor.foreground": "#1b1640",
      "editor.selectionBackground": "#ffe1c7",
      "editorIndentGuide.background1": "#efe8df",
      "editorWidget.background": "#ffffff",
      "editorWidget.border": "#e0d7cc",
    },
  });
  monaco.editor.defineTheme("aether-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "comment", foreground: "766d96", fontStyle: "italic" },
      { token: "keyword", foreground: "ff8a3d" },
      { token: "string", foreground: "ffb784" },
      { token: "number", foreground: "ff7a9a" },
      { token: "type", foreground: "a99cff" },
    ],
    colors: {
      "editor.background": "#171230",
      "editor.lineHighlightBackground": "#211a40",
      "editor.lineHighlightBorder": "#00000000",
      "editorLineNumber.foreground": "#463c6e",
      "editorLineNumber.activeForeground": "#a89fc4",
      "editorCursor.foreground": "#ff8a3d",
      "editor.selectionBackground": "#4a2f3f",
      "editor.inactiveSelectionBackground": "#33233f",
      "editorIndentGuide.background1": "#241c45",
      "editorWidget.background": "#211a40",
      "editorWidget.border": "#332a5c",
      "scrollbarSlider.background": "#ffffff14",
      "scrollbarSlider.hoverBackground": "#ffffff24",
    },
  });
}

type Palette = { base: "vs" | "vs-dark" | "hc-black"; bg: string; line: string; num: string; cursor: string; select: string; keyword: string; string: string; number: string; type: string; comment: string };
const PALETTES: Record<string, Palette> = {
  "github-light": { base: "vs", bg: "#ffffff", line: "#f6f8fa", num: "#8c959f", cursor: "#24292f", select: "#b6e3ff", keyword: "cf222e", string: "0a3069", number: "0550ae", type: "8250df", comment: "6e7781" },
  solarized: { base: "vs-dark", bg: "#002b36", line: "#073642", num: "#586e75", cursor: "#93a1a1", select: "#174652", keyword: "859900", string: "2aa198", number: "d33682", type: "b58900", comment: "586e75" },
  dracula: { base: "vs-dark", bg: "#282a36", line: "#44475a55", num: "#6272a4", cursor: "#f8f8f2", select: "#44475a", keyword: "ff79c6", string: "f1fa8c", number: "bd93f9", type: "8be9fd", comment: "6272a4" },
  monokai: { base: "vs-dark", bg: "#272822", line: "#3e3d32", num: "#90908a", cursor: "#f8f8f0", select: "#49483e", keyword: "f92672", string: "e6db74", number: "ae81ff", type: "66d9ef", comment: "75715e" },
  nord: { base: "vs-dark", bg: "#2e3440", line: "#3b4252", num: "#616e88", cursor: "#d8dee9", select: "#434c5e", keyword: "81a1c1", string: "a3be8c", number: "b48ead", type: "8fbcbb", comment: "616e88" },
  "high-contrast": { base: "hc-black", bg: "#000000", line: "#1a1a1a", num: "#ffffff", cursor: "#ffff00", select: "#264f78", keyword: "ffff00", string: "00ff9f", number: "ff9d00", type: "00e5ff", comment: "9aa0a6" },
};

function definePalettes(monaco: Monaco) {
  for (const [name, p] of Object.entries(PALETTES)) {
    monaco.editor.defineTheme(`aether-${name}`, {
      base: p.base,
      inherit: true,
      rules: [
        { token: "comment", foreground: p.comment, fontStyle: "italic" },
        { token: "keyword", foreground: p.keyword },
        { token: "string", foreground: p.string },
        { token: "number", foreground: p.number },
        { token: "type", foreground: p.type },
      ],
      colors: {
        "editor.background": p.bg,
        "editor.lineHighlightBackground": p.line,
        "editor.lineHighlightBorder": "#00000000",
        "editorLineNumber.foreground": p.num,
        "editorCursor.foreground": p.cursor,
        "editor.selectionBackground": p.select,
      },
    });
  }
}

export function CodeEditor({
  path,
  language,
  value,
  onChange,
  readOnly,
  settings,
  onRun,
  onSubmit,
  guardPaste = false,
  onBlockedPaste,
}: {
  /** One model per question, so each keeps its own undo history. */
  path: string;
  language: string;
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
  settings: EditorSettings;
  /** Ctrl/Cmd+Enter. */
  onRun: () => void;
  /** Ctrl/Cmd+Shift+Enter. */
  onSubmit: () => void;
  /** Block pasting or dropping text that was not copied in this editor (ADR-0037). */
  guardPaste?: boolean;
  onBlockedPaste?: () => void;
}) {
  const appTheme = useTheme();
  // "system" follows the app's theme toggle.
  const dark = settings.theme === "system" ? appTheme === "dark" : settings.theme === "dark";
  const monacoTheme = settings.theme in PALETTES ? `aether-${settings.theme}` : dark ? "aether-dark" : "aether-light";
  // Monaco commands are registered once; they call the latest handlers.
  const handlers = useRef({ onRun, onSubmit, guardPaste, onBlockedPaste });
  useEffect(() => {
    handlers.current = { onRun, onSubmit, guardPaste, onBlockedPaste };
  }, [onRun, onSubmit, guardPaste, onBlockedPaste]);
  const mount: OnMount = (editor, monaco) => {
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => handlers.current.onRun());
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Enter, () => handlers.current.onSubmit());
    // Text copied inside the editor may be pasted back; anything else is
    // blocked while the exam's paste guard is on, as in the exam app.
    const node = editor.getDomNode();
    if (!node) return;
    const copied: string[] = [];
    const remember = () => {
      const selection = editor.getSelection();
      const text = selection ? (editor.getModel()?.getValueInRange(selection) ?? "").trim() : "";
      if (text) copied.splice(0, copied.length, ...[...copied, text].slice(-20));
    };
    const guard = (text: string, event: Event) => {
      const trimmed = text.trim();
      if (!handlers.current.guardPaste || trimmed === "" || copied.includes(trimmed)) return;
      event.preventDefault();
      event.stopPropagation();
      handlers.current.onBlockedPaste?.();
    };
    node.addEventListener("copy", remember, true);
    node.addEventListener("cut", remember, true);
    node.addEventListener("paste", (event) => guard(event.clipboardData?.getData("text/plain") ?? "", event), true);
    node.addEventListener("drop", (event) => guard(event.dataTransfer?.getData("text/plain") ?? "", event), true);
  };
  return (
    <Editor
      path={path}
      language={editorLanguage(language)}
      value={value}
      onChange={(next) => onChange(next ?? "")}
      beforeMount={(monaco) => {
        defineThemes(monaco);
        definePalettes(monaco);
      }}
      onMount={mount}
      theme={monacoTheme}
      loading={null}
      options={{
        readOnly,
        // The context menu pastes through the clipboard API, past the guard.
        contextmenu: !guardPaste,
        fontFamily: "var(--font-geist-mono), ui-monospace, Consolas, monospace",
        fontSize: settings.fontSize,
        lineHeight: Math.round(settings.fontSize * 1.6),
        fontLigatures: false,
        minimap: { enabled: settings.minimap },
        wordWrap: settings.wordWrap ? "on" : "off",
        lineNumbers: settings.lineNumbers ? "on" : "off",
        scrollBeyondLastLine: false,
        smoothScrolling: true,
        cursorBlinking: "smooth",
        cursorSmoothCaretAnimation: "on",
        tabSize: settings.tabSize,
        detectIndentation: false,
        automaticLayout: true,
        padding: { top: 16, bottom: 16 },
        lineNumbersMinChars: 3,
        renderLineHighlight: "line",
        overviewRulerLanes: 0,
        hideCursorInOverviewRuler: true,
        scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10, useShadows: false },
        wordBasedSuggestions: settings.autocomplete ? "currentDocument" : "off",
        quickSuggestions: settings.autocomplete,
        suggestOnTriggerCharacters: settings.autocomplete,
        stickyScroll: { enabled: false },
      }}
    />
  );
}
