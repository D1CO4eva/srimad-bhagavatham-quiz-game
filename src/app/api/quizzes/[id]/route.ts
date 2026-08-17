import { firestore } from "@/lib/firestore";
import { generateUniqueSlug } from "@/lib/slug";

function parseNullableDate(value: unknown): { ok: true; value: Date | null } | { ok: false } {
  if (value === null) return { ok: true, value: null };
  if (typeof value !== "string") return { ok: false };
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { ok: false };
  return { ok: true, value: date };
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => null);

  const data: {
    title?: string;
    status?: "PUBLISHED";
    showLeaderboardDefault?: boolean;
    showTimerDefault?: boolean;
    scoringMode?: "SPEED" | "ACCURACY";
    leadTimeSecs?: number;
    responsesOpen?: boolean;
    opensAt?: Date | null;
    closesAt?: Date | null;
    slug?: string;
  } = {};

  if (body?.title !== undefined) {
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title || title.length > 200) {
      return Response.json({ error: "title is required (max 200 characters)." }, { status: 400 });
    }
    data.title = title;
  }

  if (body?.publish === true) {
    data.status = "PUBLISHED";
  }

  if (typeof body?.showLeaderboardDefault === "boolean") {
    data.showLeaderboardDefault = body.showLeaderboardDefault;
  }
  if (typeof body?.showTimerDefault === "boolean") {
    data.showTimerDefault = body.showTimerDefault;
  }
  if (body?.scoringMode === "SPEED" || body?.scoringMode === "ACCURACY") {
    data.scoringMode = body.scoringMode;
  }
  if (typeof body?.leadTimeSecs === "number") {
    if (!Number.isInteger(body.leadTimeSecs) || body.leadTimeSecs < 0 || body.leadTimeSecs > 30) {
      return Response.json({ error: "leadTimeSecs must be an integer between 0 and 30." }, { status: 400 });
    }
    data.leadTimeSecs = body.leadTimeSecs;
  }

  if (typeof body?.responsesOpen === "boolean") {
    data.responsesOpen = body.responsesOpen;
  }

  if (body?.opensAt !== undefined) {
    const parsed = parseNullableDate(body.opensAt);
    if (!parsed.ok) {
      return Response.json({ error: "opensAt must be an ISO date string or null." }, { status: 400 });
    }
    data.opensAt = parsed.value;
  }
  if (body?.closesAt !== undefined) {
    const parsed = parseNullableDate(body.closesAt);
    if (!parsed.ok) {
      return Response.json({ error: "closesAt must be an ISO date string or null." }, { status: 400 });
    }
    data.closesAt = parsed.value;
  }

  if (Object.keys(data).length === 0) {
    return Response.json({ error: "Nothing to update." }, { status: 400 });
  }

  const quizRef = firestore.collection("quizzes").doc(id);
  const existingSnap = await quizRef.get();
  if (!existingSnap.exists) {
    return Response.json({ error: "Quiz not found." }, { status: 404 });
  }
  const existing = existingSnap.data()!;
  const existingOpensAt: Date | null = existing.opensAt?.toDate?.() ?? null;
  const existingClosesAt: Date | null = existing.closesAt?.toDate?.() ?? null;

  // "closesAt after opensAt" must hold for the resulting row, whether either
  // side is changing in this request or was already set from a previous one.
  const effectiveOpensAt = "opensAt" in data ? data.opensAt : existingOpensAt;
  const effectiveClosesAt = "closesAt" in data ? data.closesAt : existingClosesAt;
  if (effectiveOpensAt && effectiveClosesAt && effectiveClosesAt <= effectiveOpensAt) {
    return Response.json({ error: "closesAt must be after opensAt." }, { status: 400 });
  }

  // Publishing a SELF_PACED quiz opens it to responses and mints its
  // permanent shareable slug (once — never regenerated on a later rename).
  if (data.status === "PUBLISHED" && existing.mode === "SELF_PACED") {
    data.responsesOpen = true;
    if (!existing.slug) {
      data.slug = await generateUniqueSlug(data.title ?? existing.title);
    }
  }

  await quizRef.update(data);
  const updatedSnap = await quizRef.get();
  const updated = updatedSnap.data()!;

  return Response.json({
    id: quizRef.id,
    title: updated.title,
    status: updated.status,
    mode: updated.mode,
    slug: updated.slug ?? null,
    responsesOpen: updated.responsesOpen,
    opensAt: updated.opensAt?.toDate?.() ?? null,
    closesAt: updated.closesAt?.toDate?.() ?? null,
  });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const quizRef = firestore.collection("quizzes").doc(id);
  const [quizSnap, gameSessionCountSnap, responseCountSnap] = await Promise.all([
    quizRef.get(),
    firestore.collection("gameSessions").where("quizId", "==", id).count().get(),
    quizRef.collection("responses").count().get(),
  ]);
  if (!quizSnap.exists) {
    return Response.json({ error: "Quiz not found." }, { status: 404 });
  }
  if (gameSessionCountSnap.data().count > 0) {
    return Response.json({ error: "This quiz has game sessions and can't be deleted." }, { status: 400 });
  }
  if (responseCountSnap.data().count > 0) {
    return Response.json({ error: "This quiz has responses and can't be deleted." }, { status: 400 });
  }

  // Firestore has no cascade delete — recursiveDelete() removes the Quiz doc
  // and every subcollection under it (questions, responses) in one call.
  // This is the only place cascade delete is ever exercised in the app
  // (confirmed via grep — GameSession/Player/Answer/SessionResult are never
  // deleted anywhere), so no other cascade handling is needed elsewhere.
  await firestore.recursiveDelete(quizRef);

  return Response.json({ ok: true });
}
