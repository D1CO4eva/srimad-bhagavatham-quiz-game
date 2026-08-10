import { loginHostAction } from "./actions";

export default async function HostLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center gap-6 px-6 py-16">
      <div>
        <span className="pill-badge">Host</span>
        <h1 className="mt-3 text-3xl">Enter the host passcode</h1>
        <p className="mt-2 text-ink-soft">Only the class host needs this — ask whoever&rsquo;s running the session.</p>
      </div>

      <form action={loginHostAction} className="card flex flex-col gap-4 p-6">
        <input type="hidden" name="next" value={next ?? "/host"} />
        <input
          type="password"
          name="passcode"
          placeholder="Passcode"
          autoFocus
          required
          className="input-field"
        />
        <button type="submit" className="btn btn-primary">
          Enter
        </button>
        {error && <p className="text-sm text-danger">That passcode didn&rsquo;t match. Try again.</p>}
      </form>
    </div>
  );
}
