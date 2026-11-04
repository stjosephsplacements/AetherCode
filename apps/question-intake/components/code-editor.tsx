"use client";

import Editor, { type Monaco, loader } from "@monaco-editor/react";

// Served from public/monaco (scripts/copy-monaco.mjs), never a CDN: the same setup as the platform's exam screen.
loader.config({ paths: { vs: "/monaco/vs" } });

function defineTheme(monaco: Monaco) {
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
}


export function CodeEditor({ path, language, value, onChange, height = 380, wrap = false }: { path: string; language: string; value: string; onChange: (value: string) => void; height?: number; wrap?: boolean }) {
  return (
    <div className="overflow-hidden rounded-[var(--radius-control)] border border-line-strong" style={{ height }}>
      <Editor
        path={path}
        language={language}
        value={value}
        onChange={(next) => onChange(next ?? "")}
        beforeMount={defineTheme}
        theme="aether-light"
        loading={<div className="grid h-full place-items-center text-[13px] text-ink-subtle">Loading the editor...</div>}
        options={{
          fontFamily: "var(--font-geist-mono), ui-monospace, Consolas, monospace",
          fontSize: 14,
          lineHeight: 22,
          fontLigatures: false,
          minimap: { enabled: false },
          wordWrap: wrap ? "on" : "off",
          scrollBeyondLastLine: false,
          smoothScrolling: true,
          cursorBlinking: "smooth",
          tabSize: 4,
          detectIndentation: false,
          automaticLayout: true,
          padding: { top: 14, bottom: 14 },
          lineNumbersMinChars: 3,
          renderLineHighlight: "line",
          overviewRulerLanes: 0,
          hideCursorInOverviewRuler: true,
          scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10, useShadows: false },
        }}
      />
    </div>
  );
}
