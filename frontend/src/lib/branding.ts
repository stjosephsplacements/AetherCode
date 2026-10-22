/**
 * Per-college branding (ADR-0045): a display name, an accent colour and a
 * logo, set in a file the operator mounts, not in the platform's database.
 */
export type CollegeBrand = { name?: string; color?: string; logo?: string; logos?: string[] };
export type BrandingConfig = { default: CollegeBrand; tenants: Record<string, CollegeBrand> };

const HEX = /^#[0-9a-f]{6}$/i;
const LOGO = /^[A-Za-z0-9][A-Za-z0-9._-]*\.(png|jpe?g|webp|svg)$/i;

/** WCAG relative luminance of a "#rrggbb" colour. */
export function luminance(hex: string): number {
  const channel = (offset: number) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/**
 * An accent has to stay readable as a button and as text on both the light and
 * the dark canvas, so only mid-tone colours are accepted.
 */
export function usableAccent(hex: string): boolean {
  if (!HEX.test(hex)) return false;
  const value = luminance(hex);
  return value >= 0.12 && value <= 0.3;
}

function parseBrand(value: unknown, where: string, problems: string[]): CollegeBrand {
  const brand: CollegeBrand = {};
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    problems.push(`${where}: expected an object`);
    return brand;
  }
  const { name, color, logo, logos } = value as Record<string, unknown>;
  if (name !== undefined) {
    if (typeof name === "string" && name.trim() && name.length <= 60) brand.name = name.trim();
    else problems.push(`${where}.name: expected 1 to 60 characters`);
  }
  if (color !== undefined) {
    if (typeof color === "string" && usableAccent(color)) brand.color = color.toLowerCase();
    else problems.push(`${where}.color: expected a #rrggbb colour that reads on light and dark backgrounds`);
  }
  if (logo !== undefined) {
    if (typeof logo === "string" && LOGO.test(logo)) brand.logo = logo;
    else problems.push(`${where}.logo: expected a png, jpg, webp or svg file name without a path`);
  }
  if (logos !== undefined) {
    if (Array.isArray(logos) && logos.length >= 1 && logos.length <= 5 && logos.every((entry) => typeof entry === "string" && LOGO.test(entry))) brand.logos = logos as string[];
    else problems.push(`${where}.logos: expected 1 to 5 png, jpg, webp or svg file names without a path`);
  }
  return brand;
}

/** The files to show, in order: `logos`, else the single `logo`. */
export function logoFiles(brand: CollegeBrand): string[] {
  return brand.logos ?? (brand.logo ? [brand.logo] : []);
}

/** Parses the branding file. Invalid entries are dropped and reported, never half-applied. */
export function parseBranding(text: string): { config: BrandingConfig; problems: string[] } {
  const problems: string[] = [];
  const config: BrandingConfig = { default: {}, tenants: {} };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { config, problems: ["not valid JSON"] };
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { config, problems: ["expected an object"] };
  const { default: defaults, tenants } = raw as Record<string, unknown>;
  if (defaults !== undefined) config.default = parseBrand(defaults, "default", problems);
  if (tenants !== undefined) {
    if (typeof tenants !== "object" || tenants === null || Array.isArray(tenants)) problems.push("tenants: expected an object");
    else {
      for (const [id, brand] of Object.entries(tenants)) {
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) problems.push(`tenants.${id}: expected a tenant ID`);
        else config.tenants[id.toLowerCase()] = parseBrand(brand, `tenants.${id}`, problems);
      }
    }
  }
  return { config, problems };
}

/** The college's brand: its own entry over the default. */
export function pickBrand(config: BrandingConfig, tenantId: string | null): CollegeBrand {
  return { ...config.default, ...(tenantId ? config.tenants[tenantId.toLowerCase()] : undefined) };
}

/** CSS variables that recolour the accent in both themes. */
export function accentStyle(color: string): Record<string, string> {
  // Dark text on a light accent, white text otherwise: whichever contrasts more.
  const value = luminance(color);
  const onWhite = 1.05 / (value + 0.05);
  const onDark = (value + 0.05) / (luminance("#1f1e1d") + 0.05);
  return {
    "--brand": color,
    "--brand-hover": `color-mix(in srgb, ${color} 85%, black)`,
    "--brand-ink": onWhite >= onDark ? "#fdfdfb" : "#1f1e1d",
    "--brand-soft": `color-mix(in srgb, ${color} 14%, var(--surface))`,
    "--brand-soft-ink": `color-mix(in srgb, ${color} 70%, var(--ink))`,
  };
}
