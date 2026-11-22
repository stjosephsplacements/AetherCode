"use client";

import { CaretDown, CaretUp, Pencil, Plus, ShieldCheck, Trash } from "@phosphor-icons/react/ssr";
import { useActionState, useState } from "react";
import { panel } from "@/app/admin/_dashboard/panel";
import { Checkbox, FormMessage, initialActionState } from "@/components/staff/form";
import { Badge } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { type Resource, addPermission, isLockedRead, removePermission, sameSet } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { createRole, deleteRole, updateRole } from "./actions";

type RoleData = {
  id: string;
  guild_kind: string;
  name: string;
  tier: number;
  position: number;
  permissions: string[];
  managed: boolean;
  system_key?: string;
};

type Group = { area: string; resources: Resource[] };

const TIER_LABELS: Record<number, string> = { 3: "Gold", 2: "Silver", 1: "Bronze" };
const TIER_TONE: Record<number, "brand" | "warning" | "neutral"> = { 3: "warning", 2: "brand", 1: "neutral" };

const fieldClass =
  "h-10 w-full rounded-control border border-line bg-surface px-3 text-sm text-ink outline-none transition-[border-color,box-shadow] placeholder:text-ink-subtle focus:border-brand focus:ring-4 focus:ring-brand/15";

export function RoleList({
  roles,
  groups,
  canManage,
}: {
  roles: RoleData[];
  groups: Group[];
  canManage: boolean;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const role = roles.find((entry) => entry.id === selected);

  return (
    <div className="grid gap-3 xl:grid-cols-12">
      <section className={cn(panel, "xl:col-span-4")}>
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <h2 className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-subtle">Roles</h2>
            <p className="mt-1 text-[12.5px] text-ink-muted">Pick a role to inspect or edit its grants.</p>
          </div>
          {canManage && (
            <Button type="button" size="sm" variant="secondary" onClick={() => { setCreating(true); setSelected(null); }}>
              <Plus className="size-3.5" />
              New
            </Button>
          )}
        </div>
        <ul className="max-h-[68vh] space-y-1.5 overflow-y-auto" aria-label="Roles">
          {roles.map((entry) => {
            const current = selected === entry.id && !creating;
            return (
              <li key={entry.id}>
                <button
                  type="button"
                  onClick={() => { setSelected(entry.id); setCreating(false); }}
                  aria-current={current ? "true" : undefined}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-control border px-3 py-2.5 text-left transition-[color,background-color,box-shadow]",
                    current
                      ? "border-brand/40 bg-brand-soft/20 font-medium text-ink"
                      : "border-line bg-hover/30 text-ink-muted hover:bg-hover hover:text-ink",
                  )}
                >
                  <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-control bg-brand-soft text-brand-soft-ink">
                    <ShieldCheck className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={cn("block truncate text-[14px]", current ? "font-semibold text-ink" : "font-medium")}>{entry.name}</span>
                    <span className="mt-1 flex flex-wrap items-center gap-1">
                      <Badge tone={TIER_TONE[entry.tier] ?? "neutral"}>{TIER_LABELS[entry.tier] ?? `Tier ${entry.tier}`}</Badge>
                      {entry.managed && <Badge tone="warning">System</Badge>}
                      <span className="text-[11px] text-ink-subtle">{entry.permissions.length} grants</span>
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <div className="flex min-w-0 flex-col gap-3 xl:col-span-8">
        {creating ? (
          <CreateRoleForm groups={groups} onDone={() => setCreating(false)} />
        ) : role ? (
          <RoleDetail role={role} groups={groups} canManage={canManage} />
        ) : (
          <section className={cn(panel, "flex flex-1 flex-col justify-center")}>
            <div className="mx-auto max-w-sm px-4 py-10 text-center text-sm text-ink-muted">
              <span className="mx-auto mb-3 grid size-11 place-items-center rounded-control bg-brand/15 text-brand">
                <ShieldCheck className="size-5" />
              </span>
              <p className="mb-2 text-[15px] font-medium text-ink">Select a role</p>
              Choose one on the left to see its permissions{canManage ? ", or create a custom role" : ""}.
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function PermissionGrid({
  groups,
  held,
  onChange,
  readOnly,
}: {
  groups: Group[];
  held: Set<string>;
  onChange?: (next: Set<string>) => void;
  readOnly?: boolean;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggle = (area: string) => {
    const next = new Set(collapsed);
    if (next.has(area)) next.delete(area);
    else next.add(area);
    setCollapsed(next);
  };

  return (
    <div className="space-y-2">
      {groups.map((group) => {
        const open = !collapsed.has(group.area);
        const count = group.resources.reduce((sum, resource) => sum + resource.verbs.filter((verb) => held.has(`${resource.id}.${verb}`)).length, 0);
        return (
          <div key={group.area} className="overflow-hidden rounded-control border border-line bg-surface">
            <button
              type="button"
              onClick={() => toggle(group.area)}
              className="flex w-full items-center gap-2 bg-hover/40 px-3.5 py-2.5 text-left font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-subtle hover:text-ink"
            >
              {open ? <CaretDown className="size-3" /> : <CaretUp className="size-3" />}
              {group.area}
              {count > 0 && <span className="ml-auto font-mono text-[11px] normal-case tracking-normal text-brand">{count}</span>}
            </button>
            {open && (
              <div className="grid gap-x-3 gap-y-1 border-t border-line px-3.5 py-2.5" style={{ gridTemplateColumns: "minmax(0,1fr) repeat(3, 52px)" }}>
                <span />
                <span className="text-center text-[10px] font-medium uppercase tracking-wider text-ink-subtle">See</span>
                <span className="text-center text-[10px] font-medium uppercase tracking-wider text-ink-subtle">Change</span>
                <span className="text-center text-[10px] font-medium uppercase tracking-wider text-ink-subtle">Delete</span>
                {group.resources.map((resource) => (
                  <PermissionRow key={resource.id} resource={resource} held={held} onChange={onChange} readOnly={readOnly} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function PermissionRow({
  resource,
  held,
  onChange,
  readOnly,
}: {
  resource: Resource;
  held: Set<string>;
  onChange?: (next: Set<string>) => void;
  readOnly?: boolean;
}) {
  return (
    <>
      <span className="truncate text-[13px] text-ink">{resource.label}</span>
      {(["read", "write", "delete"] as const).map((verb) => {
        const key = `${resource.id}.${verb}`;
        const available = resource.verbs.includes(verb);
        const checked = held.has(key);
        const locked = isLockedRead(key, held);
        return (
          <span key={verb} className="flex justify-center">
            {available ? (
              readOnly ? (
                <span className={cn("size-3.5 rounded-chip", checked ? "bg-brand" : "bg-line")} />
              ) : (
                <Checkbox
                  checked={checked}
                  disabled={locked}
                  onCheckedChange={() => {
                    if (!onChange) return;
                    onChange(checked ? removePermission(held, key) : addPermission(held, key));
                  }}
                />
              )
            ) : (
              <span className="size-3.5" />
            )}
          </span>
        );
      })}
    </>
  );
}

function RoleDetail({ role, groups, canManage }: { role: RoleData; groups: Group[]; canManage: boolean }) {
  const [editing, setEditing] = useState(false);
  const [permissions, setPermissions] = useState(() => new Set(role.permissions));
  const [name, setName] = useState(role.name);
  const [updated, saveAction] = useActionState(updateRole, initialActionState);
  const [deleted, deleteAction] = useActionState(deleteRole, initialActionState);
  const dirty = name !== role.name || !sameSet(permissions, new Set(role.permissions));

  return (
    <div className="flex flex-col gap-3" key={role.id}>
      <section className={cn(panel)}>
        <div className="flex flex-wrap items-center gap-3">
          <span aria-hidden className="grid size-11 shrink-0 place-items-center rounded-control bg-brand-soft text-brand-soft-ink">
            <ShieldCheck className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-subtle">Selected</p>
            <h2 className="mt-0.5 truncate text-[17px] font-semibold tracking-[-0.02em] text-ink">{role.name}</h2>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <Badge tone={TIER_TONE[role.tier] ?? "neutral"}>{TIER_LABELS[role.tier] ?? `Tier ${role.tier}`}</Badge>
              {role.managed && <Badge tone="warning">System-managed</Badge>}
              <span className="text-[12px] text-ink-subtle">
                {role.permissions.length} permission{role.permissions.length === 1 ? "" : "s"}
              </span>
            </div>
          </div>
          {canManage && !role.managed && (
            <Button type="button" size="sm" variant={editing ? "ghost" : "secondary"} onClick={() => setEditing(!editing)}>
              <Pencil className="size-3.5" />
              {editing ? "Cancel" : "Edit"}
            </Button>
          )}
        </div>
      </section>

      <section className={cn(panel, "flex-1")}>
        {editing && !role.managed ? (
          <>
            <div className="mb-3">
              <h3 className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-subtle">Edit role</h3>
              <p className="mt-1 text-[12.5px] text-ink-muted">Rename and adjust grants. Writes imply See.</p>
            </div>
            <form action={saveAction} className="space-y-4">
              <input type="hidden" name="role_id" value={role.id} />
              <label className="block text-sm">
                <span className="mb-1.5 block font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-subtle">Name</span>
                <input name="name" value={name} onChange={(event) => setName(event.target.value)} className={fieldClass} />
              </label>
              <input type="hidden" name="position" value={role.position} />
              <PermissionGrid groups={groups} held={permissions} onChange={(next) => setPermissions(next)} />
              {[...permissions].map((permission) => (
                <input key={permission} type="hidden" name="permission" value={permission} />
              ))}
              <FormMessage state={updated} />
              <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
                <Button type="submit" size="sm" disabled={!dirty}>
                  Save changes
                </Button>
              </div>
            </form>
            <form action={deleteAction} className="mt-4 border-t border-line pt-3">
              <input type="hidden" name="role_id" value={role.id} />
              <Button type="submit" size="sm" variant="ghost" className="text-danger hover:text-danger">
                <Trash className="size-3.5" />
                Delete role
              </Button>
              <FormMessage state={deleted} />
            </form>
          </>
        ) : (
          <>
            <div className="mb-3">
              <h3 className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-subtle">Permissions</h3>
              <p className="mt-1 text-[12.5px] text-ink-muted">
                {role.managed ? "System roles are fixed; grants below are read-only." : "What this role allows across the platform."}
              </p>
            </div>
            <PermissionGrid groups={groups} held={new Set(role.permissions)} readOnly />
          </>
        )}
      </section>
    </div>
  );
}

function CreateRoleForm({ groups, onDone }: { groups: Group[]; onDone: () => void }) {
  const [state, formAction] = useActionState(createRole, initialActionState);
  const [permissions, setPermissions] = useState<Set<string>>(new Set());
  const [tier, setTier] = useState(2);

  if (state?.message) onDone();

  return (
    <section className={cn(panel)}>
      <div className="mb-4">
        <h2 className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-subtle">New role</h2>
        <p className="mt-1 text-[15px] font-medium text-ink">Create a custom college role</p>
        <p className="mt-1 text-[12.5px] text-ink-muted">Name it, pick a tier, then tick the grants it should include.</p>
      </div>
      <form action={formAction} className="space-y-4">
        <label className="block text-sm">
          <span className="mb-1.5 block font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-subtle">Name</span>
          <input name="name" required className={fieldClass} placeholder="e.g. Exam coordinator" />
        </label>
        <label className="block text-sm">
          <span className="mb-1.5 block font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-subtle">Tier</span>
          <select name="tier" value={tier} onChange={(event) => setTier(Number(event.target.value))} className={fieldClass}>
            <option value={3}>Gold (spans colleges)</option>
            <option value={2}>Silver (one college)</option>
            <option value={1}>Bronze (batch or person)</option>
          </select>
        </label>
        <input type="hidden" name="position" value="0" />
        <PermissionGrid groups={groups} held={permissions} onChange={(next) => setPermissions(next)} />
        {[...permissions].map((permission) => (
          <input key={permission} type="hidden" name="permission" value={permission} />
        ))}
        <FormMessage state={state} />
        <div className="flex flex-wrap gap-2 border-t border-line pt-3">
          <Button type="submit" size="sm">
            Create role
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        </div>
      </form>
    </section>
  );
}
