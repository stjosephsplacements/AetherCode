import type { Metadata } from "next";
import { LoadError, PageHeader } from "@/components/staff/page-header";
import { ConsortiumDrives } from "./drives-board";
import { listPlacement } from "@/lib/server/directory";
import { requirePlacement } from "@/lib/server/placement";
import { primaryPlacementOrganization } from "@/lib/server/placement-org";

export const metadata: Metadata = { title: "Consortium drives" };

export default async function PlacementDrivesPage() {
  const placement = await requirePlacement();
  const tenantId = placement.colleges[0]?.id;
  if (!tenantId) {
    return (
      <div className="animate-enter">
        <PageHeader title="Consortium drives" />
        <p className="text-sm text-ink-muted">No college context for this placement session.</p>
      </div>
    );
  }
  let tracks: { id: string; name: string }[];
  try {
    const directory = await listPlacement();
    const organization = primaryPlacementOrganization(directory);
    tracks = (organization?.departments ?? []).map((track) => ({ id: track.id, name: track.name }));
  } catch (error) {
    return (
      <div className="animate-enter">
        <PageHeader title="Consortium drives" />
        <LoadError error={error} />
      </div>
    );
  }
  return (
    <div className="animate-enter">
      <PageHeader title="Consortium drives" description="Cross-college leaderboards for students on a placement track (ADR-0081 C)." />
      {tracks.length === 0 ? (
        <p className="text-sm text-ink-muted">Add a placement track first.</p>
      ) : (
        <ConsortiumDrives tracks={tracks} tenantId={tenantId} />
      )}
    </div>
  );
}