import { cn, languageName } from "@/lib/utils";

/** Logos are the languages' own marks (Simple Icons, CC0), drawn as a mask so each takes its brand colour. */
const LOGOS: Record<string, { file: string; color: string }> = {
  c: { file: "c", color: "#5C6BC0" },
  cpp: { file: "cplusplus", color: "#00599C" },
  csharp: { file: "dotnet", color: "#512BD4" },
  bash: { file: "gnubash", color: "#4EAA25" },
  go: { file: "go", color: "#00ADD8" },
  javascript: { file: "javascript", color: "#F0C800" },
  kotlin: { file: "kotlin", color: "#7F52FF" },
  java: { file: "openjdk", color: "#ED8B00" },
  php: { file: "php", color: "#777BB4" },
  python: { file: "python", color: "#3776AB" },
  ruby: { file: "ruby", color: "#CC342D" },
  rust: { file: "rust", color: "var(--ink)" },
  sqlite: { file: "sqlite", color: "#0F80CC" },
  typescript: { file: "typescript", color: "#3178C6" },
};

/** The judge's language key (c, cpp17, python3...) as the logo family it belongs to. */
const familyOf = (key: string) => (key.startsWith("cpp") ? "cpp" : key.startsWith("python") ? "python" : key);

export function LanguageIcon({ language, className }: { language: string; className?: string }) {
  const logo = LOGOS[familyOf(language)];
  if (!logo) return <span aria-hidden className={cn("inline-block size-4 shrink-0 rounded bg-hover", className)} />;
  const url = `url(/langs/${logo.file}.svg)`;
  return <span aria-hidden className={cn("inline-block size-4 shrink-0", className)} style={{ background: logo.color, WebkitMask: `${url} center / contain no-repeat`, mask: `${url} center / contain no-repeat` }} />;
}

/** Logo and name, for a language picker. */
export function LanguageLabel({ language }: { language: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <LanguageIcon language={language} />
      {languageName(language)}
    </span>
  );
}
