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
      <p className="text-lg font-medium">Something went wrong.</p>
      <button
        type="button"
        onClick={reset}
        className="rounded-full bg-black px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
      >
        Try again
      </button>
    </div>
  );
}
