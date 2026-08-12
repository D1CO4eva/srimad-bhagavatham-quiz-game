/**
 * Full-screen interstitial shown for a few seconds before a question starts,
 * carrying a Sri Swamiji quote (src/lib/swamijiQuotes.ts) so players can
 * connect with him between questions rather than it just being a bare wait.
 * Host and player screens both render this off the same `quote_display`
 * Ably broadcast, so everyone sees the same quote at the same time.
 */
export function QuoteOverlay({ quote, attribution }: { quote: string; attribution: string }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-brand-ink/95 px-8 backdrop-blur-sm">
      <div className="flex max-w-xl flex-col items-center gap-5 text-center animate-[rise_0.5s_ease]">
        <span className="text-3xl text-gold">🪷</span>
        <p className="whitespace-pre-line font-serif text-2xl leading-snug text-white sm:text-3xl">
          &ldquo;{quote}&rdquo;
        </p>
        <p className="text-xs font-semibold tracking-wide text-gold-soft uppercase">— {attribution}</p>
      </div>
    </div>
  );
}
