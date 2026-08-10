import { db } from "@/lib/db";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => null);

  const data: { title?: string; status?: "PUBLISHED" } = {};

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

  if (Object.keys(data).length === 0) {
    return Response.json({ error: "Nothing to update." }, { status: 400 });
  }

  const existing = await db.quiz.findUnique({ where: { id }, select: { id: true } });
  if (!existing) {
    return Response.json({ error: "Quiz not found." }, { status: 404 });
  }

  const quiz = await db.quiz.update({
    where: { id },
    data,
    select: { id: true, title: true, status: true },
  });

  return Response.json(quiz);
}
