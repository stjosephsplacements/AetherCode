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
      { token: "comment", foreground: "8a96a0", fontStyle: "italic" },
      { token: "keyword", foreground: "037a43" },
      { token: "string", foreground: "2d7a4c" },
      { token: "number", foreground: "6a4fb0" },
      { token: "type", foreground: "1f6f8b" },
    ],
    colors: {
      "editor.background": "#ffffff",
      "editor.lineHighlightBackground": "#f4f5f6",
      "editor.lineHighlightBorder": "#00000000",
      "editorLineNumber.foreground": "#b8c0c6",
      "editorLineNumber.activeForeground": "#576871",
      "editorCursor.foreground": "#0e141e",
      "editor.selectionBackground": "#cdeedb",
      "editorIndentGuide.background1": "#eceff1",
      "editorWidget.background": "#ffffff",
      "editorWidget.border": "#dfe2e5",
    },
  });
  monaco.editor.defineTheme("aether-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "comment", foreground: "6d7a86", fontStyle: "italic" },
      { token: "keyword", foreground: "05c770" },
      { token: "string", foreground: "aef96c" },
      { token: "number", foreground: "c3a6f2" },
      { token: "type", foreground: "7cc4e4" },
    ],
    colors: {
      "editor.background": "#141c28",
      "editor.lineHighlightBackground": "#1b2533",
      "editor.lineHighlightBorder": "#00000000",
      "editorLineNumber.foreground": "#3d4a5a",
      "editorLineNumber.activeForeground": "#9aa7b0",
      "editorCursor.foreground": "#05c770",
      "editor.selectionBackground": "#1d4a37",
      "editor.inactiveSelectionBackground": "#18382c",
      "editorIndentGuide.background1": "#1f2a38",
      "editorWidget.background": "#1b2533",
      "editorWidget.border": "#2a3646",
      "scrollbarSlider.background": "#ffffff14",
      "scrollbarSlider.hoverBackground": "#ffffff24",
    },
  });
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
