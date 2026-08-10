import Link from "next/link";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 px-6 text-center">
      <span className="pill-badge">Bhagavatam Self-Study</span>
      <h1 className="max-w-2xl text-5xl leading-[0.95] sm:text-6xl">Quiz Live</h1>
      <p className="max-w-md text-lg text-ink-soft">
        Host a live round from an existing quiz, or join one already in progress with a PIN.
      </p>
      <div className="flex flex-col gap-4 sm:flex-row">
        <Link href="/host" className="btn btn-primary">
          I&apos;m Hosting
        </Link>
        <Link href="/join" className="btn btn-secondary">
          I&apos;m Joining
        </Link>
      </div>
    </div>
  );
}
