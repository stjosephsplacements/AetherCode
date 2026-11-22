import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { panel } from "@/app/admin/_dashboard/panel";
import { PageHeader } from "@/components/staff/page-header";
import { gateway, GatewayError } from "@/lib/server/gateway";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Talent card" };

type TalentCardClaims = {
  display_name?: string;
  college?: string;
  department?: string;
  roll_number?: string;
  issued_at?: string;
  expires_at?: string;
  metrics?: Record<string, unknown>;
};

export default async function TalentCardVerifyPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!token || token.length < 8) notFound();

  let claims: TalentCardClaims;
  try {
    claims = await gateway<TalentCardClaims>(`/analytics/v1/public/talent-cards/${encodeURIComponent(token)}`, {
      anonymous: true,
    });
  } catch (error) {
    if (error instanceof GatewayError && (error.status === 404 || error.status === 400)) notFound();
    throw error;
  }

  return (
    <main className="mx-auto max-w-lg px-4 py-16">
      <PageHeader title="Talent card" description="Verified claim from AetherCode. Check the expiry before relying on it." />
      <section className={cn(panel, "mt-6 space-y-3")}>
        <p className="text-[18px] font-semibold text-ink">{claims.display_name || "Student"}</p>
        <dl className="grid gap-2 text-sm text-ink-muted">
          {claims.college ? (
            <div>
              <dt className="text-[12px] uppercase tracking-wide text-ink-subtle">College</dt>
              <dd className="text-ink">{claims.college}</dd>
            </div>
          ) : null}
          {claims.department ? (
            <div>
              <dt className="text-[12px] uppercase tracking-wide text-ink-subtle">Department</dt>
              <dd className="text-ink">{claims.department}</dd>
            </div>
          ) : null}
          {claims.roll_number ? (
            <div>
              <dt className="text-[12px] uppercase tracking-wide text-ink-subtle">Roll</dt>
              <dd className="font-mono text-ink">{claims.roll_number}</dd>
            </div>
          ) : null}
          {claims.expires_at ? (
            <div>
              <dt className="text-[12px] uppercase tracking-wide text-ink-subtle">Expires</dt>
              <dd className="text-ink">{new Date(claims.expires_at).toLocaleString()}</dd>
            </div>
          ) : null}
        </dl>
      </section>
    </main>
  );
}
