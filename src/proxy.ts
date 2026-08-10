import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { HOST_SESSION_COOKIE, isValidHostSession } from "@/lib/hostAuth";

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname === "/host/login") return NextResponse.next();

  const token = request.cookies.get(HOST_SESSION_COOKIE)?.value;
  if (isValidHostSession(token)) return NextResponse.next();

  const loginUrl = new URL("/host/login", request.url);
  loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/host/:path*"],
};
