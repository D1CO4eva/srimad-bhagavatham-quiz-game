import { db } from "@/lib/db";
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

  const existing = await db.quiz.findUnique({
    where: { id },
    select: { id: true, title: true, mode: true, slug: true, opensAt: true, closesAt: true },
  });
  if (!existing) {
    return Response.json({ error: "Quiz not found." }, { status: 404 });
  }

  // "closesAt after opensAt" must hold for the resulting row, whether either
  // side is changing in this request or was already set from a previous one.
  const effectiveOpensAt = "opensAt" in data ? data.opensAt : existing.opensAt;
  const effectiveClosesAt = "closesAt" in data ? data.closesAt : existing.closesAt;
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

  const quiz = await db.quiz.update({
    where: { id },
    data,
    select: {
      id: true,
      title: true,
      status: true,
      mode: true,
      slug: true,
      responsesOpen: true,
      opensAt: true,
      closesAt: true,
    },
  });

  return Response.json(quiz);
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const existing = await db.quiz.findUnique({
    where: { id },
    select: { id: true, _count: { select: { gameSessions: true, responses: true } } },
  });
  if (!existing) {
    return Response.json({ error: "Quiz not found." }, { status: 404 });
  }
  if (existing._count.gameSessions > 0) {
    return Response.json(
      { error: "This quiz has game sessions and can't be deleted." },
      { status: 400 }
    );
  }
  if (existing._count.responses > 0) {
    return Response.json(
      { error: "This quiz has responses and can't be deleted." },
      { status: 400 }
    );
  }

  await db.quiz.delete({ where: { id } });

  return Response.json({ ok: true });
}
