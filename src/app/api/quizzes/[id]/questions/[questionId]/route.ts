import { db } from "@/lib/db";
import { MIN_TIME_LIMIT_SECS, MAX_TIME_LIMIT_SECS } from "@/lib/timeLimits";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; questionId: string }> }
) {
  const { id, questionId } = await params;
  const body = await request.json().catch(() => null);

  const question = await db.question.findUnique({
    where: { id: questionId },
    select: { id: true, quizId: true, type: true, choices: true },
  });
  if (!question || question.quizId !== id) {
    return Response.json({ error: "Question not found." }, { status: 404 });
  }

  const quiz = await db.quiz.findUnique({ where: { id }, select: { status: true } });
  if (!quiz) {
    return Response.json({ error: "Quiz not found." }, { status: 404 });
  }
  if (quiz.status !== "DRAFT") {
    return Response.json({ error: "Only draft quizzes can be edited." }, { status: 400 });
  }

  const data: { choices?: string[]; answer?: string; timeLimitSecs?: number } = {};

  if (body?.choices !== undefined) {
    if (question.type !== "MULTIPLE_CHOICE") {
      return Response.json(
        { error: "Only multiple-choice questions support editing choice text." },
        { status: 400 }
      );
    }
    const choices = Array.isArray(body.choices)
      ? body.choices
          .map((choice: unknown) => (typeof choice === "string" ? choice.trim() : ""))
          .filter((choice: string) => choice !== "")
      : [];
    if (choices.length !== 4 || new Set(choices).size !== 4) {
      return Response.json({ error: "Provide four unique, non-empty choices." }, { status: 400 });
    }
    data.choices = choices;
  }

  if (body?.answer !== undefined) {
    const answer = typeof body.answer === "string" ? body.answer.trim() : "";
    const choicePool = data.choices ?? question.choices;
    if (!answer || !choicePool.includes(answer)) {
      return Response.json({ error: "answer must be one of the question's choices." }, { status: 400 });
    }
    data.answer = answer;
  }

  if (body?.timeLimitSecs !== undefined) {
    const timeLimitSecs = Number(body.timeLimitSecs);
    if (
      !Number.isInteger(timeLimitSecs) ||
      timeLimitSecs < MIN_TIME_LIMIT_SECS ||
      timeLimitSecs > MAX_TIME_LIMIT_SECS
    ) {
      return Response.json(
        { error: `timeLimitSecs must be an integer between ${MIN_TIME_LIMIT_SECS} and ${MAX_TIME_LIMIT_SECS}.` },
        { status: 400 }
      );
    }
    data.timeLimitSecs = timeLimitSecs;
  }

  if (Object.keys(data).length === 0) {
    return Response.json({ error: "Nothing to update." }, { status: 400 });
  }

  const updated = await db.question.update({
    where: { id: questionId },
    data,
    select: { id: true, type: true, question: true, choices: true, answer: true, timeLimitSecs: true },
  });

  return Response.json(updated);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; questionId: string }> }
) {
  const { id, questionId } = await params;

  const question = await db.question.findUnique({
    where: { id: questionId },
    select: { id: true, quizId: true },
  });
  if (!question || question.quizId !== id) {
    return Response.json({ error: "Question not found." }, { status: 404 });
  }

  const quiz = await db.quiz.findUnique({
    where: { id },
    select: { status: true, _count: { select: { questions: true } } },
  });
  if (!quiz) {
    return Response.json({ error: "Quiz not found." }, { status: 404 });
  }
  if (quiz.status !== "DRAFT") {
    return Response.json({ error: "Only draft quizzes can be edited." }, { status: 400 });
  }
  if (quiz._count.questions <= 1) {
    return Response.json({ error: "A quiz must have at least one question." }, { status: 400 });
  }

  // Question order must stay contiguous (0..n-1) — game sessions identify the
  // last question by `order === questions.length - 1`, which a gap would break.
  await db.$transaction(async (tx) => {
    await tx.question.delete({ where: { id: questionId } });
    const remaining = await tx.question.findMany({
      where: { quizId: id },
      orderBy: { order: "asc" },
      select: { id: true, order: true },
    });
    for (const [index, remainingQuestion] of remaining.entries()) {
      if (remainingQuestion.order !== index) {
        await tx.question.update({ where: { id: remainingQuestion.id }, data: { order: index } });
      }
    }
  });

  return Response.json({ ok: true });
}
