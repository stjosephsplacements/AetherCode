"use client";

import { CircleNotch, DotsSixVertical, Lock, MagnifyingGlass, X } from "@phosphor-icons/react/ssr";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { FormMessage, type ActionState } from "@/components/staff/form";
import { Button } from "@/components/ui/button";
import { type Resource, type Verb, addPermission, isLockedRead, removePermission, resourceLabel, sameSet, withImplied } from "@/lib/permissions";
import { cn } from "@/lib/utils";

type Group = { area: string; resources: Resource[] };

const VERB_LABEL: Record<Verb, string> = { read: "See", write: "Change", delete: "Delete" };

/**
 * Drag a permission from the pool into the person's box, or click it. Dropping
 * Change or Delete brings the See it depends on along (ADR-0055).
 */
export function PermissionEditor({
  groups,
  initial,
  canGrantPlatformOnly,
  onSave,
}: {
  groups: Group[];
  initial: string[];
  canGrantPlatformOnly: boolean;
  onSave: (permissions: string[]) => Promise<ActionState>;
}) {
  const router = useRouter();
  const start = withImplied(initial);
  const [held, setHeld] = useState<Set<string>>(start);
  const [query, setQuery] = useState("");
  const [over, setOver] = useState(false);
  const [state, setState] = useState<ActionState>({ error: null });
  const [pending, startTransition] = useTransition();
  const needle = query.trim().toLowerCase();
  const dirty = !sameSet(held, start);
  const labelOf = new Map(groups.flatMap((group) => group.resources.map((resource) => [resource.id, resource] as const)));

  function add(permission: string) {
    const resource = labelOf.get(permission.slice(0, permission.lastIndexOf(".")));
    if (!resource || (resource.platformOnly && !canGrantPlatformOnly)) return;
    setHeld((current) => addPermission(current, permission));
    setState({ error: null });
  }
  function remove(permission: string) {
    setHeld((current) => removePermission(current, permission));
    setState({ error: null });
  }
  function save() {
    startTransition(async () => {
      const result = await onSave([...held]);
      setState(result);
      if (!result.error) router.refresh();
    });
  }

  const grantedByResource = [...labelOf.values()]
    .map((resource) => ({ resource, verbs: resource.verbs.filter((verb) => held.has(`${resource.id}.${verb}`)) }))
    .filter((entry) => entry.verbs.length > 0);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section aria-label="Everything that can be granted">
        <div className="relative mb-3">
          <MagnifyingGlass aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find a permission"
            aria-label="Find a permission"
            className="h-10 w-full rounded-[var(--radius-control)] border border-line-strong bg-surface pl-9 pr-3 text-sm text-ink outline-none transition-[border-color,box-shadow] placeholder:text-ink-subtle focus:border-brand focus:ring-4 focus:ring-brand/15"
          />
        </div>
        <div className="max-h-[68vh] space-y-5 overflow-y-auto pr-1">
          {groups.map((group) => {
            const shown = group.resources.filter((resource) => !needle || resource.label.toLowerCase().includes(needle) || group.area.toLowerCase().includes(needle));
            if (shown.length === 0) return null;
            return (
              <div key={group.area}>
                <h2 className="mb-1.5 font-mono text-[11px] uppercase tracking-[0.08em] text-ink-subtle">{group.area}</h2>
                <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-surface)] border border-line bg-surface">
                  {shown.map((resource) => {
                    const locked = resource.platformOnly && !canGrantPlatformOnly;
                    return (
                      <li key={resource.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                        <span className="flex items-center gap-2 text-[14px] text-ink">
                          {resource.label}
                          {locked && <Lock aria-label="Root administrators only" className="size-3.5 text-ink-subtle" />}
                        </span>
                        <span className="flex gap-1.5">
                          {resource.verbs.map((verb) => {
                            const permission = `${resource.id}.${verb}`;
                            const on = held.has(permission);
                            return (
                              <button
                                key={verb}
                                type="button"
                                draggable={!locked && !on}
                                disabled={locked || on}
                                onDragStart={(event) => event.dataTransfer.setData("text/plain", permission)}
                                onClick={() => add(permission)}
                                aria-label={`${VERB_LABEL[verb]} ${resource.label.toLowerCase()}`}
                                className={cn(
                                  "inline-flex h-7 cursor-grab items-center gap-1 rounded-full border px-2.5 text-[12.5px] transition-colors active:cursor-grabbing",
                                  on ? "cursor-default border-line bg-hover text-ink-subtle" : "border-line-strong bg-surface text-ink hover:border-brand hover:text-brand",
                                  locked && "cursor-not-allowed opacity-45",
                                )}
                              >
                                {!on && !locked && <DotsSixVertical aria-hidden className="size-3 text-ink-subtle" />}
                                {VERB_LABEL[verb]}
                              </button>
                            );
                          })}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      </section>

      <section aria-label="Permissions this person holds">
        <div
          onDragOver={(event) => {
            event.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(event) => {
            event.preventDefault();
            setOver(false);
            add(event.dataTransfer.getData("text/plain"));
          }}
          className={cn(
            "min-h-64 rounded-[var(--radius-surface)] border-2 border-dashed p-4 transition-colors",
            over ? "border-brand bg-brand/5" : "border-line-strong",
          )}
        >
          {grantedByResource.length === 0 ? (
            <p className="py-16 text-center text-sm text-ink-muted">Drag permissions here. Whatever the person&apos;s role already allows stays; these are on top.</p>
          ) : (
            <ul className="space-y-2">
              {grantedByResource.map(({ resource, verbs }) => (
                <li key={resource.id} className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-control)] bg-surface px-3 py-2 shadow-[var(--shadow-hairline)]">
                  <span className="text-[14px] font-medium text-ink">{resource.label || resourceLabel(resource.id)}</span>
                  <span className="flex gap-1.5">
                    {verbs.map((verb) => {
                      const permission = `${resource.id}.${verb}`;
                      const locked = isLockedRead(permission, held);
                      return (
                        <span key={verb} className="inline-flex h-7 items-center gap-1 rounded-full bg-brand/10 pl-2.5 pr-1 text-[12.5px] text-brand">
                          {VERB_LABEL[verb]}
                          {locked ? (
                            <Lock aria-label="Needed by the permissions above" className="mr-1.5 size-3" />
                          ) : (
                            <button type="button" onClick={() => remove(permission)} aria-label={`Remove ${VERB_LABEL[verb].toLowerCase()} ${resource.label.toLowerCase()}`} className="grid size-5 place-items-center rounded-full hover:bg-brand/15">
                              <X className="size-3" />
                            </button>
                          )}
                        </span>
                      );
                    })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="mt-3 flex items-center justify-between gap-3">
          <FormMessage state={state} />
          <div className="ml-auto flex gap-2">
            <Button type="button" variant="ghost" disabled={!dirty || pending} onClick={() => setHeld(withImplied(initial))}>
              Undo
            </Button>
            <Button type="button" disabled={!dirty || pending} onClick={save}>
              {pending && <CircleNotch className="animate-spin" />}
              Save permissions
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
