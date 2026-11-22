import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { type BrandingConfig, logoFiles, parseBranding, pickBrand, usableAccent } from "@/lib/branding";
import { gateway } from "@/lib/server/gateway";

const EMPTY: BrandingConfig = { default: {}, tenants: {} };
let cached: { file: string; content: string; config: BrandingConfig } | null = null;

type BrandingView = {
  app_name?: string | null;
  accent_color?: string | null;
  logos?: { id: string; url?: string; content_type: string; position: number; alt_text: string }[];
};

/** The branding file, re-read when it changes, so a new logo needs no restart. */
async function loadConfig(): Promise<{ file: string; config: BrandingConfig } | null> {
  const file = process.env.BRANDING_FILE?.trim();
  if (!file) return null;
  try {
    const content = await readFile(file, "utf8");
    if (cached?.file !== file || cached.content !== content) {
      const { config, problems } = parseBranding(content);
      for (const problem of problems) console.warn(`BRANDING_FILE ${file}: ${problem}`);
      cached = { file, content, config };
    }
    return { file, config: cached.config };
  } catch (error) {
    console.warn(`BRANDING_FILE ${file} could not be read: ${error instanceof Error ? error.message : error}`);
    return { file, config: cached?.file === file ? cached.config : EMPTY };
  }
}

export type Brand = { name: string | null; color: string | null; logoURLs: string[] };

function gatewayLogoURL(rawURL: string | undefined, logoID: string, tenantId: string | null): string {
  if (rawURL?.startsWith("http://") || rawURL?.startsWith("https://")) return rawURL;
  const query = tenantId ? `?tenant_id=${encodeURIComponent(tenantId)}` : "";
  return `/api/tenant/v1/branding/logos/${encodeURIComponent(logoID)}${query}`;
}

async function brandFromGateway(tenantId: string | null): Promise<Brand | null> {
  const query = tenantId ? `?tenant_id=${encodeURIComponent(tenantId)}` : "";
  try {
    const view = await gateway<BrandingView>(`/tenant/v1/branding${query}`, { anonymous: true });
    const hasData =
      Boolean(view.app_name?.trim()) ||
      Boolean(view.accent_color && usableAccent(view.accent_color)) ||
      Boolean(view.logos?.length);
    if (!hasData) return null;
    return {
      name: view.app_name?.trim() || null,
      color: view.accent_color && usableAccent(view.accent_color) ? view.accent_color.toLowerCase() : null,
      logoURLs: (view.logos ?? [])
        .sort((left, right) => left.position - right.position)
        .map((logo) => gatewayLogoURL(logo.url, logo.id, tenantId)),
    };
  } catch {
    return null;
  }
}

/** The brand to show a viewer in a college; the AetherCode defaults when none is set. */
export async function brandFor(tenantId: string | null): Promise<Brand> {
  const fromGateway = await brandFromGateway(tenantId);
  if (fromGateway) return fromGateway;
  const loaded = await loadConfig();
  const brand = loaded ? pickBrand(loaded.config, tenantId) : {};
  return {
    name: brand.name ?? null,
    color: brand.color ?? null,
    logoURLs: logoFiles(brand).map((_, index) => `/branding/logo?n=${index}${tenantId ? `&tenant=${encodeURIComponent(tenantId)}` : ""}`),
  };
}

/** A college's logo file from beside the branding file, by its configured name only. */
export async function logoFor(tenantId: string | null, index = 0): Promise<{ data: Buffer; type: string } | null> {
  const loaded = await loadConfig();
  if (!loaded) return null;
  const logo = logoFiles(pickBrand(loaded.config, tenantId))[index];
  if (!logo) return null;
  const extension = path.extname(logo).slice(1).toLowerCase();
  const type = extension === "svg" ? "image/svg+xml" : extension === "png" ? "image/png" : extension === "webp" ? "image/webp" : "image/jpeg";
  try {
    return { data: await readFile(path.join(path.dirname(loaded.file), logo)), type };
  } catch {
    return null;
  }
}