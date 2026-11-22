"use client";

import { useEffect, useState } from "react";
import { SimilarityTokenViz } from "@/components/staff/similarity-token-viz";
import type { SimilarityAlign } from "@/lib/api-types";
import { api } from "@/lib/client/api";

export function SimilarityAlignPanel({
  tenantId,
  versionId,
  examItemId,
  attemptA,
  attemptB,
}: {
  tenantId: string;
  versionId: string;
  examItemId: string;
  attemptA: string;
  attemptB: string;
}) {
  const [align, setAlign] = useState<SimilarityAlign | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const query = new URLSearchParams({ exam_item_id: examItemId, attempt_a: attemptA, attempt_b: attemptB });
    void api<SimilarityAlign>(`/submission/v1/tenants/${tenantId}/exam-versions/${versionId}/similarity/align?${query}`)
      .then(setAlign)
      .catch((caught: Error) => setError(caught.message));
  }, [tenantId, versionId, examItemId, attemptA, attemptB]);

  if (error) return <p className="mt-4 text-sm text-danger">{error}</p>;
  if (!align) return <p className="mt-4 text-sm text-ink-muted">Loading token alignment…</p>;
  return <SimilarityTokenViz align={align} />;
}