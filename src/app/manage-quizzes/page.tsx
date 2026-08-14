import Link from "next/link";
import { logoutHostAction } from "@/app/host/login/actions";

export default function ManageQuizzesPage() {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-8 px-6 py-16">
      <div className="flex items-start justify-between gap-4">
        <div>
          <span className="pill-badge">Host</span>
          <h1 className="mt-3 text-4xl">What are you running?</h1>
          <p className="mt-2 text-ink-soft">Pick which kind of quiz you want to manage.</p>
        </div>
        <form action={logoutHostAction}>
          <button type="submit" className="text-sm font-semibold text-ink-soft underline">
            Log out
          </button>
        </form>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Link href="/host" className="card flex flex-col gap-2 p-6 transition hover:-translate-y-1">
          <p className="font-serif text-2xl text-brand-ink">Live Kahoot Quiz</p>
          <p className="text-sm text-ink-soft">
            Host a real-time, tap-to-answer session with a join PIN, a live leaderboard, and everyone
            answering the same question at once.
          </p>
        </Link>
        <Link
          href="/manage-quizzes/self-paced"
          className="card flex flex-col gap-2 p-6 transition hover:-translate-y-1"
        >
          <p className="font-serif text-2xl text-brand-ink">Self-Paced Quiz</p>
          <p className="text-sm text-ink-soft">
            Publish a shareable link students fill out on their own time, like a form — see everyone&rsquo;s
            scores and the most-missed questions afterward.
          </p>
        </Link>
      </div>
    </div>
  );
}
