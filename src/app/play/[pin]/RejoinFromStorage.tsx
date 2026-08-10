"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getPlayerSession } from "@/lib/playerSession";

/**
 * Reached /play/{pin} without playerId/nickname in the URL (a bookmark, a
 * stripped query string, browser restoring a bare tab). Falls back to the
 * sessionStorage record from this PIN if one exists (Story 7.1) before
 * giving up and pointing back to /join.
 *
 * Loaded with ssr:false (see page.tsx) so it only ever renders client-side —
 * sessionStorage has no server-side equivalent to mismatch against.
 */
export function RejoinFromStorage({ pin }: { pin: string }) {
  const router = useRouter();
  const existing = getPlayerSession(pin);

  useEffect(() => {
    if (existing) {
      router.replace(`/play/${pin}?playerId=${existing.playerId}&nickname=${encodeURIComponent(existing.nickname)}`);
    }
  }, [existing, pin, router]);

  if (existing) return null;

  return (
    <div className="flex min-h-screen items-center justify-center px-6 text-center">
      <p className="text-ink-soft">
        Missing player info. Join again from the{" "}
        <a href="/join" className="font-semibold text-brand underline">
          join page
        </a>
        .
      </p>
    </div>
  );
}
