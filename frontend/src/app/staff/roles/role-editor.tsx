"use client";

import { useActionState, useState } from "react";
import { Pencil, Trash, Plus, ShieldCheck, CaretDown, CaretUp } from "@phosphor-icons/react/ssr";
import { Checkbox, FormMessage, initialActionState } from "@/components/staff/form";
import { Button } from "@/components/ui/button";
import { type Resource, isLockedRead, addPermission, removePermission, sameSet } from "@/lib/permissions";
import { createRole, updateRole, deleteRole } from "./actions";

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
  const role = roles.find((r) => r.id === selected);

  return (
    <div className="grid gap-6 xl:grid-cols-[280px_minmax(0,1fr)]">
      <div className="space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-ink-muted">Roles</h2>
        <ul className="space-y-0.5">
          {roles.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => { setSelected(r.id); setCreating(false); }}
                className={`flex w-full items-center gap-2 rounded-[var(--radius-control)] px-3 py-2 text-left text-sm transition-colors ${selected === r.id ? "bg-brand-soft text-brand-soft-ink font-medium" : "text-ink hover:bg-hover"}`}
              >
                <ShieldCheck className="size-4 shrink-0" />
                <span className="truncate">{r.name}</span>
                <span className="ml-auto text-[11px] text-ink-subtle">{TIER_LABELS[r.tier] ?? `T${r.tier}`}</span>
                {r.managed && <span className="text-[10px] text-ink-subtle">(system)</span>}
              </button>
            </li>
          ))}
        </ul>
        {canManage && (
          <button
            type="button"
            onClick={() => { setCreating(true); setSelected(null); }}
            className="flex w-full items-center gap-2 rounded-[var(--radius-control)] px-3 py-2 text-left text-sm text-brand hover:bg-brand-soft"
          >
            <Plus className="size-4" />
            New role
          </button>
        )}
      </div>

      <div className="min-w-0">
        {creating ? (
          <CreateRoleForm groups={groups} onDone={() => setCreating(false)} />
        ) : role ? (
          <RoleDetail role={role} groups={groups} canManage={canManage} />
        ) : (
          <div className="rounded-[var(--radius-surface)] border border-line bg-surface p-8 text-center text-sm text-ink-muted">
            Choose a role to see its permissions, or create a new one.
          </div>
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
    if (next.has(area)) { next.delete(area); } else { next.add(area); }
    setCollapsed(next);
  };

  return (
    <div className="space-y-1">
      {groups.map((group) => {
        const open = !collapsed.has(group.area);
        const count = group.resources.reduce((sum, r) => sum + r.verbs.filter((v) => held.has(`${r.id}.${v}`)).length, 0);
        return (
          <div key={group.area}>
            <button
              type="button"
              onClick={() => toggle(group.area)}
              className="flex w-full items-center gap-2 px-1 py-1.5 text-left text-xs font-semibold uppercase tracking-widest text-ink-muted hover:text-ink"
            >
              {open ? <CaretDown className="size-3" /> : <CaretUp className="size-3" />}
              {group.area}
              {count > 0 && <span className="ml-1 font-mono text-[10px] text-brand">{count}</span>}
            </button>
            {open && (
              <div className="mb-2 grid gap-x-4 gap-y-0.5 pl-5" style={{ gridTemplateColumns: "minmax(0,1fr) repeat(3, 60px)" }}>
                <span />
                <span className="text-center text-[10px] font-medium uppercase tracking-wider text-ink-subtle">Read</span>
                <span className="text-center text-[10px] font-medium uppercase tracking-wider text-ink-subtle">Write</span>
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
                <span className={`size-3.5 rounded-sm ${checked ? "bg-brand" : "bg-line"}`} />
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
    <div className="space-y-4" key={role.id}>
      <div className="flex items-center gap-3">
        <h2 className="text-lg font-semibold text-ink">{role.name}</h2>
        <span className="rounded-full bg-hover px-2.5 py-0.5 text-xs text-ink-muted">{TIER_LABELS[role.tier] ?? `Tier ${role.tier}`}</span>
        {role.managed && <span className="rounded-full bg-warning/10 px-2.5 py-0.5 text-xs text-warning">System-managed</span>}
        {canManage && !role.managed && (
          <div className="ml-auto flex gap-2">
            <button type="button" onClick={() => setEditing(!editing)} className="inline-flex items-center gap-1.5 text-xs text-brand hover:underline">
              <Pencil className="size-3.5" />
              {editing ? "Cancel" : "Edit"}
            </button>
          </div>
        )}
      </div>

      {editing && !role.managed ? (
        <>
          <form action={saveAction} className="space-y-4 rounded-[var(--radius-surface)] border border-line bg-surface p-4">
            <input type="hidden" name="role_id" value={role.id} />
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-ink">Name</span>
              <input name="name" value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2 text-sm text-ink" />
            </label>
            <input type="hidden" name="position" value={role.position} />
            <PermissionGrid groups={groups} held={permissions} onChange={(next) => setPermissions(next)} />
            {[...permissions].map((p) => <input key={p} type="hidden" name="permission" value={p} />)}
            <FormMessage state={updated} />
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={!dirty}>Save changes</Button>
            </div>
          </form>
          <form action={deleteAction} className="mt-2">
            <input type="hidden" name="role_id" value={role.id} />
            <Button type="submit" size="sm" variant="ghost" className="text-danger hover:text-danger">
              <Trash className="size-3.5" />
              Delete role
            </Button>
            <FormMessage state={deleted} />
          </form>
        </>
      ) : (
        <div className="rounded-[var(--radius-surface)] border border-line bg-surface p-4">
          <p className="mb-3 text-xs text-ink-muted">{role.permissions.length} permission{role.permissions.length !== 1 ? "s" : ""}</p>
          <PermissionGrid groups={groups} held={new Set(role.permissions)} readOnly />
        </div>
      )}
    </div>
  );
}

function CreateRoleForm({ groups, onDone }: { groups: Group[]; onDone: () => void }) {
  const [state, formAction] = useActionState(createRole, initialActionState);
  const [permissions, setPermissions] = useState<Set<string>>(new Set());
  const [tier, setTier] = useState(2);

  if (state?.message) onDone();

  return (
    <form action={formAction} className="space-y-4 rounded-[var(--radius-surface)] border border-line bg-surface p-4">
      <h2 className="text-lg font-semibold text-ink">New role</h2>
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-ink">Name</span>
        <input name="name" required className="w-full rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2 text-sm text-ink" placeholder="e.g. Exam coordinator" />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-ink">Tier</span>
        <select name="tier" value={tier} onChange={(e) => setTier(Number(e.target.value))} className="w-full rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2 text-sm text-ink">
          <option value={3}>Gold (spans colleges)</option>
          <option value={2}>Silver (one college)</option>
          <option value={1}>Bronze (batch or person)</option>
        </select>
      </label>
      <input type="hidden" name="position" value="0" />
      <PermissionGrid groups={groups} held={permissions} onChange={(next) => setPermissions(next)} />
      {[...permissions].map((p) => <input key={p} type="hidden" name="permission" value={p} />)}
      <FormMessage state={state} />
      <div className="flex gap-2">
        <Button type="submit" size="sm">Create role</Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>Cancel</Button>
      </div>
    </form>
  );
}
