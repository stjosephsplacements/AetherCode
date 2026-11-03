"use client";

import { X } from "@phosphor-icons/react/ssr";
import { useId, useRef, useState } from "react";
import { MAX_TAGS, normalizeTag } from "@/components/staff/question-wizard/model";
import { cn } from "@/lib/utils";

export type TagSuggestion = { name: string; count: number };

/**
 * Tags as chips. Type and press Enter or comma to add one, Backspace to remove
 * the last; tags already in use are suggested as you type. Written the way the
 * question bank stores them, so what you see is what is saved.
 */
export function TagInput({ value, onChange, suggestions, id, disabled }: { value: string[]; onChange: (tags: string[]) => void; suggestions: TagSuggestion[]; id?: string; disabled?: boolean }) {
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();

  const needle = normalizeTag(draft);
  const matches = suggestions.filter((suggestion) => !value.includes(suggestion.name) && (!needle || suggestion.name.includes(needle))).slice(0, 8);
  const full = value.length >= MAX_TAGS;

  function add(raw: string) {
    const tag = normalizeTag(raw);
    setDraft("");
    setActive(0);
    if (!tag || value.includes(tag) || full) return;
    onChange([...value, tag]);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === ",") {
      if (draft.trim() === "" && event.key === "Enter") return;
      event.preventDefault();
      add(open && matches[active] ? matches[active].name : draft);
    } else if (event.key === "Backspace" && draft === "" && value.length > 0) {
      onChange(value.slice(0, -1));
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActive((current) => Math.min(current + 1, Math.max(matches.length - 1, 0)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((current) => Math.max(current - 1, 0));
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div className="relative">
      <div
        onClick={() => input.current?.focus()}
        className={cn(
          "flex min-h-10 w-full flex-wrap items-center gap-1.5 rounded-[var(--radius-control)] border border-line-strong bg-surface px-2 py-1.5 shadow-[var(--shadow-hairline)] transition-[border-color,box-shadow] hover:border-ink-subtle focus-within:border-brand focus-within:ring-4 focus-within:ring-brand/15",
          disabled && "pointer-events-none opacity-60",
        )}
      >
        {value.map((tag) => (
          <span key={tag} className="inline-flex h-7 items-center gap-1 rounded-full bg-hover pl-2.5 pr-1 text-[13px] text-ink">
            {tag}
            <button
              type="button"
              aria-label={`Remove tag ${tag}`}
              onClick={(event) => {
                event.stopPropagation();
                onChange(value.filter((entry) => entry !== tag));
              }}
              className="grid size-5 place-items-center rounded-full text-ink-muted transition-colors hover:bg-line hover:text-ink"
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
        <input
          ref={input}
          id={id}
          role="combobox"
          aria-expanded={open && matches.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && matches[active] ? `${listId}-${active}` : undefined}
          value={draft}
          disabled={disabled || full}
          onChange={(event) => {
            setDraft(event.target.value);
            setOpen(true);
            setActive(0);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            setOpen(false);
            if (draft.trim()) add(draft);
          }}
          onKeyDown={onKeyDown}
          placeholder={value.length === 0 ? "Add a tag, like two-pointers" : full ? "" : "Add another"}
          className="h-7 min-w-32 flex-1 bg-transparent px-1 text-sm text-ink outline-none placeholder:text-ink-subtle"
        />
      </div>
      {open && matches.length > 0 && (
        <ul id={listId} role="listbox" className="absolute left-0 right-0 top-full z-30 mt-1 max-h-60 overflow-y-auto rounded-[var(--radius-control)] border border-line-strong bg-surface p-1 shadow-[var(--shadow-overlay)]">
          {matches.map((suggestion, index) => (
            <li
              key={suggestion.name}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === active}
              // mousedown, not click: the input would blur first and close the list.
              onMouseDown={(event) => {
                event.preventDefault();
                add(suggestion.name);
              }}
              onMouseEnter={() => setActive(index)}
              className={cn("flex cursor-default items-center justify-between rounded-md px-2.5 py-1.5 text-[13.5px] text-ink", index === active && "bg-hover")}
            >
              {suggestion.name}
              <span className="font-mono text-[11.5px] tabular-nums text-ink-subtle">{suggestion.count}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-1.5 text-xs text-ink-muted">{full ? `At most ${MAX_TAGS} tags.` : "Enter or comma adds a tag. Tags describe the question in more detail than its category."}</p>
    </div>
  );
}
