"use client";

import "./globals.css";
import { ErrorView } from "@/components/site/error-view";

// Replaces the root layout when it fails, so it brings its own <html> and styles.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body>
        <ErrorView
          code="500"
          title="AetherCode couldn't load"
          message="The app failed before it could start. Try again in a moment."
          incident={error.digest}
          onRetry={reset}
        />
      </body>
    </html>
  );
}
