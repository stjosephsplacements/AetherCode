"use client";

import Editor, { type Monaco, type OnMount, loader } from "@monaco-editor/react";
import { useEffect, useRef, useSyncExternalStore } from "react";
import type { EditorSettings } from "./editor-settings";
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
      { token: "comment", foreground: "8f8d86", fontStyle: "italic" },
      { token: "keyword", foreground: "9f4724" },
      { token: "string", foreground: "2d7a4c" },
      { token: "number", foreground: "6a4fb0" },
    ],
    colors: {
      "editor.background": "#fdfdfb",
      "editor.lineHighlightBackground": "#f3f2ec",
      "editor.lineHighlightBorder": "#00000000",
      "editorLineNumber.foreground": "#c2bfb5",
      "editorLineNumber.activeForeground": "#63625c",
      "editorCursor.foreground": "#b5532e",
      "editor.selectionBackground": "#f0dcd1",
      "editorIndentGuide.background1": "#ecebe4",
      "editorWidget.background": "#fdfdfb",
      "editorWidget.border": "#e5e3da",
    },
  });
  monaco.editor.defineTheme("aether-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "comment", foreground: "85837c", fontStyle: "italic" },
      { token: "keyword", foreground: "e38a6c" },
      { token: "string", foreground: "8fcfa4" },
      { token: "number", foreground: "b9a6ec" },
    ],
    colors: {
      "editor.background": "#2f2f2c",
      "editor.lineHighlightBackground": "#383734",
      "editor.lineHighlightBorder": "#00000000",
      "editorLineNumber.foreground": "#5c5a55",
      "editorLineNumber.activeForeground": "#b0aea6",
      "editorCursor.foreground": "#d97757",
      "editor.selectionBackground": "#5a3d32",
      "editorIndentGuide.background1": "#3b3a37",
      "editorWidget.background": "#2f2f2c",
      "editorWidget.border": "#3b3a37",
    },
  });
}

const DARK = "(prefers-color-scheme: dark)";

function subscribeToScheme(change: () => void) {
  const query = window.matchMedia(DARK);
  query.addEventListener("change", change);
  return () => query.removeEventListener("change", change);
}

function usePrefersDark(): boolean {
  return useSyncExternalStore(subscribeToScheme, () => window.matchMedia(DARK).matches, () => false);
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
  const systemDark = usePrefersDark();
  const dark = settings.theme === "system" ? systemDark : settings.theme === "dark";
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
      beforeMount={defineThemes}
      onMount={mount}
      theme={dark ? "aether-dark" : "aether-light"}
      loading={null}
      options={{
        readOnly,
        // The context menu pastes through the clipboard API, past the guard.
        contextmenu: !guardPaste,
        fontFamily: "var(--font-geist-mono), ui-monospace, Consolas, monospace",
        fontSize: settings.fontSize,
        lineHeight: Math.round(settings.fontSize * 1.6),
        fontLigatures: false,
        minimap: { enabled: false },
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
