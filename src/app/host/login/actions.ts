"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { HOST_SESSION_COOKIE, createHostSessionCookieValue, isCorrectPasscode } from "@/lib/hostAuth";

function safeNextPath(next: FormDataEntryValue | null): string {
  const value = typeof next === "string" ? next : "";
  // Only allow same-app relative paths under /host — never redirect off-site.
  return value.startsWith("/host") ? value : "/host";
}

export async function loginHostAction(formData: FormData) {
  const passcode = String(formData.get("passcode") ?? "");
  const next = safeNextPath(formData.get("next"));

  if (!passcode || !isCorrectPasscode(passcode)) {
    redirect(`/host/login?next=${encodeURIComponent(next)}&error=1`);
  }

  const cookieStore = await cookies();
  cookieStore.set(HOST_SESSION_COOKIE, createHostSessionCookieValue(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 7 * 24 * 60 * 60,
  });

  redirect(next);
}

export async function logoutHostAction() {
  const cookieStore = await cookies();
  cookieStore.delete(HOST_SESSION_COOKIE);
  redirect("/host/login");
}
