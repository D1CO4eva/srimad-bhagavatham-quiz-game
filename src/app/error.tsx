"use client";

import { useEffect } from "react";

/**
 * Root error boundary (Story 8.2): a crash surfaces as "something went
 * wrong" with a retry instead of a blank page, and gets logged with enough
 * context to find in whatever the deploy platform's log viewer is —
 * without that, a mid-game crash reads to the host as the app just froze.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Unhandled app error", { message: error.message, digest: error.digest, stack: error.stack });
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="font-serif text-2xl text-brand-ink">Something went wrong.</p>
      <button type="button" onClick={reset} className="btn btn-primary">
        Try again
      </button>
    </div>
  );
}
