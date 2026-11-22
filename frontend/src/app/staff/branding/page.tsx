import type { Metadata } from "next";
import Image from "next/image";
import { ActionForm, Field, TextInput } from "@/components/staff/form";
import { LoadError, PageHeader } from "@/components/staff/page-header";
import { gateway } from "@/lib/server/gateway";
import { requireCollege } from "@/lib/server/staff";
import { LogoReorderButtons, LogoReorderScope } from "@/components/staff/logo-reorder";
import { deleteLogo, reorderLogos, saveBranding, uploadLogo } from "./actions";

export const metadata: Metadata = { title: "Branding" };

type BrandingView = {
  app_name?: string | null;
  accent_color?: string | null;
  logos?: { id: string; url?: string; position: number; alt_text: string }[];
};

export default async function BrandingPage() {
  const { tenantId } = await requireCollege();
  let view: BrandingView;
  try {
    view = await gateway<BrandingView>(`/tenant/v1/tenants/${tenantId}/branding`);
  } catch (error) {
    return (
      <div className="animate-enter">
        <PageHeader title="Branding" description="College name, accent colour and logos in the console." />
        <LoadError error={error} />
      </div>
    );
  }

  const logos = [...(view.logos ?? [])].sort((left, right) => left.position - right.position);
  const logoIds = logos.map((logo) => logo.id);

  return (
    <div className="animate-enter max-w-2xl space-y-8">
      <PageHeader title="Branding" description="Set the college name, accent colour and logos shown in the console shell." />

      <ActionForm action={saveBranding} submitLabel="Save branding">
        <Field label="App name" htmlFor="app_name">
          <TextInput id="app_name" name="app_name" defaultValue={view.app_name ?? ""} placeholder="Shown instead of AetherCode" maxLength={60} />
        </Field>
        <Field label="Accent colour" htmlFor="accent_color" hint="#rrggbb mid-tones only; must stay readable on light and dark backgrounds.">
          <TextInput id="accent_color" name="accent_color" defaultValue={view.accent_color ?? ""} placeholder="#336699" />
        </Field>
      </ActionForm>

      <section className="space-y-4 rounded-panel border border-line bg-surface p-5">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-subtle">Logos</h2>
        <p className="text-[13px] text-ink-muted">Up to five PNG, JPEG, WebP or SVG files. SVG uploads are sanitised before storage.</p>
        <ActionForm action={uploadLogo} submitLabel="Upload logo">
          <Field label="Logo file" htmlFor="logo">
            <input id="logo" name="logo" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="block w-full text-sm" required />
          </Field>
          <Field label="Alt text" htmlFor="alt_text">
            <TextInput id="alt_text" name="alt_text" placeholder="College mark" maxLength={200} />
          </Field>
        </ActionForm>

        <LogoReorderScope logoIds={logoIds} reorder={reorderLogos}>
          <ul className="space-y-3">
            {logos.map((logo, index) => (
              <li key={logo.id} className="flex items-center gap-4 rounded border border-line p-3">
                <div className="relative size-12 shrink-0 overflow-hidden rounded bg-canvas">
                  <Image
                    src={`/api/tenant/v1/branding/logos/${encodeURIComponent(logo.id)}?tenant_id=${encodeURIComponent(tenantId)}`}
                    alt={logo.alt_text || "Logo"}
                    fill
                    className="object-contain"
                    unoptimized
                  />
                </div>
                <div className="min-w-0 flex-1 text-sm text-ink-muted">{logo.alt_text || "Logo"}</div>
                <LogoReorderButtons index={index} />
                <ActionForm action={deleteLogo} submitLabel="Remove" submitVariant="secondary">
                  <input type="hidden" name="logo_id" value={logo.id} />
                </ActionForm>
              </li>
            ))}
          </ul>
        </LogoReorderScope>
      </section>
    </div>
  );
}