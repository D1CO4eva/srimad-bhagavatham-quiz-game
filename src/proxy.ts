import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { HOST_SESSION_COOKIE, isValidHostSession } from "@/lib/hostAuth";

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname === "/host/login") return NextResponse.next();

  const token = request.cookies.get(HOST_SESSION_COOKIE)?.value;
  if (isValidHostSession(token)) return NextResponse.next();

  // /api/quizzes/* now generates quizzes via our own metered OpenRouter key
  // (src/lib/localQuizGenerator.ts) instead of forwarding to an external
  // service, so it needs the same host-only gate as the /host pages that
  // call it — otherwise it's an unauthenticated way to spend that budget.
  if (pathname.startsWith("/api/quizzes/")) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const loginUrl = new URL("/host/login", request.url);
  loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/host/:path*", "/api/quizzes/:path*"],
};
