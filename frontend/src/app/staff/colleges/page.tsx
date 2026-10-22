import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ActionForm, Field, TextInput } from "@/components/staff/form";
import { EmptyState, LoadError, PageHeader, Section, Table } from "@/components/staff/page-header";
import { Badge, Panel } from "@/components/ui/card";
import type { Page, Tenant } from "@/lib/api-types";
import { gateway } from "@/lib/server/gateway";
import { requireStaff } from "@/lib/server/staff";
import { createCollege } from "./actions";

export const metadata: Metadata = { title: "Colleges" };

export default async function CollegesPage() {
  const staff = await requireStaff();
  if (!staff.isPlatformAdmin) redirect("/staff");
  let tenants: Tenant[];
  try {
    tenants = (await gateway<Page<Tenant>>("/tenant/v1/tenants?limit=100")).items;
  } catch (error) {
    return (
      <>
        <PageHeader title="Colleges" />
        <LoadError error={error} />
      </>
    );
  }
  return (
    <>
      <PageHeader title="Colleges" description="Every college on this platform. Each has its own students, staff, exams and results. The ID is what the branding file uses." />
      {tenants.length === 0 ? (
        <EmptyState>No colleges yet.</EmptyState>
      ) : (
        <Table head={["College", "Short name", "ID", "Status"]}>
          {tenants.map((tenant) => (
            <tr key={tenant.id}>
              <td className="px-4 py-3">
                <p className="font-medium text-ink">{tenant.display_name}</p>
                <p className="text-[12px] text-ink-muted">{tenant.legal_name}</p>
              </td>
              <td className="px-4 py-3 text-ink-muted">{tenant.slug}</td>
              <td className="px-4 py-3 font-mono text-[12px] text-ink-muted">{tenant.id}</td>
              <td className="px-4 py-3">
                <Badge tone={tenant.status === "active" ? "success" : "neutral"}>{tenant.status}</Badge>
              </td>
            </tr>
          ))}
        </Table>
      )}
      <Section title="Add a college">
        <Panel className="p-5">
          <ActionForm action={createCollege} submitLabel="Add college">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Display name" htmlFor="college-display">
                <TextInput id="college-display" name="display_name" maxLength={255} required />
              </Field>
              <Field label="Short name" hint="Lowercase letters, digits and dashes" htmlFor="college-slug">
                <TextInput id="college-slug" name="slug" pattern="[a-z0-9][a-z0-9-]{1,62}" maxLength={63} required />
              </Field>
              <Field label="Legal name" htmlFor="college-legal" className="sm:col-span-2">
                <TextInput id="college-legal" name="legal_name" maxLength={255} required />
              </Field>
            </div>
          </ActionForm>
        </Panel>
      </Section>
    </>
  );
}
