"use client";

import { Building2 } from "lucide-react";
import { chooseTenant } from "@/app/staff/actions";
import type { Tenant } from "@/lib/api-types";

export function TenantSwitcher({ tenants, current }: { tenants: Tenant[]; current: string | null }) {
  if (tenants.length === 0) return null;
  return (
    <form action={chooseTenant} className="mb-8 flex items-center gap-2 text-sm">
      <Building2 className="size-4 text-ink-muted" strokeWidth={1.75} />
      <label htmlFor="tenant_id" className="text-ink-muted">
        College
      </label>
      <select
        id="tenant_id"
        name="tenant_id"
        defaultValue={current ?? undefined}
        onChange={(event) => event.currentTarget.form?.requestSubmit()}
        className="h-8 rounded-[var(--radius-control)] border border-line-strong bg-surface px-2 text-sm text-ink"
      >
        {tenants.map((tenant) => (
          <option key={tenant.id} value={tenant.id}>
            {tenant.display_name}
          </option>
        ))}
      </select>
    </form>
  );
}
