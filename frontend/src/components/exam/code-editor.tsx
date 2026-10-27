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
