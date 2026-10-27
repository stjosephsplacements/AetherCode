"use client";

import { ErrorView } from "@/components/site/error-view";

export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <ErrorView
      code="500"
      title="Something broke on our side"
      message="This page hit an error. Trying again usually works; if it keeps happening, share the incident ID with your administrator."
      incident={error.digest}
      onRetry={reset}
    />
  );
}
