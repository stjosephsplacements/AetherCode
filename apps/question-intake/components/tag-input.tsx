"use client";

import { X } from "@phosphor-icons/react";
import { useState } from "react";
import { field } from "@/components/ui";

/** Topics as removable chips: type and press Enter or a comma. */
export function TagInput({ id, value, onChange, placeholder }: { id: string; value: string[]; onChange: (value: string[]) => void; placeholder?: string }) {
  const [text, setText] = useState("");
  const add = (raw: string) => {
    const tag = raw.trim().replace(/,$/, "").trim();
    if (tag && !value.includes(tag) && value.length < 12) onChange([...value, tag]);
    setText("");
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-[var(--radius-control)] border border-line-strong bg-surface p-1.5 focus-within:border-brand focus-within:ring-4 focus-within:ring-brand/15">
      {value.map((tag) => (
        <span key={tag} className="inline-flex items-center gap-1 rounded-full bg-brand-soft py-0.5 pl-2.5 pr-1.5 text-[12.5px] text-brand-soft-ink">
          {tag}
          <button type="button" aria-label={`Remove ${tag}`} onClick={() => onChange(value.filter((entry) => entry !== tag))} className="rounded-full p-0.5 hover:bg-hover">
            <X className="size-3" />
          </button>
        </span>
      ))}
      <input
        id={id}
        value={text}
        onChange={(event) => (event.target.value.endsWith(",") ? add(event.target.value) : setText(event.target.value))}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            add(text);
          } else if (event.key === "Backspace" && text === "" && value.length > 0) onChange(value.slice(0, -1));
        }}
        onBlur={() => add(text)}
        placeholder={value.length === 0 ? placeholder : ""}
        className={`${field} !w-auto min-w-[140px] flex-1 !border-0 !p-1 !ring-0`}
      />
    </div>
  );
}
