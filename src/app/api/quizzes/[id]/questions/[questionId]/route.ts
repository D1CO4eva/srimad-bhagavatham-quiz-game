import { firestore } from "@/lib/firestore";
import { MIN_TIME_LIMIT_SECS, MAX_TIME_LIMIT_SECS } from "@/lib/timeLimits";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; questionId: string }> }
) {
  const { id, questionId } = await params;
  const body = await request.json().catch(() => null);

  const quizRef = firestore.collection("quizzes").doc(id);
  const questionRef = quizRef.collection("questions").doc(questionId);
  const [quizSnap, questionSnap] = await Promise.all([quizRef.get(), questionRef.get()]);
  if (!questionSnap.exists) {
    return Response.json({ error: "Question not found." }, { status: 404 });
  }
  if (!quizSnap.exists) {
    return Response.json({ error: "Quiz not found." }, { status: 404 });
  }
  const question = questionSnap.data()!;

  const data: { question?: string; choices?: string[]; correctChoices?: string[]; timeLimitSecs?: number } = {};

  if (body?.question !== undefined) {
    const questionText = typeof body.question === "string" ? body.question.trim() : "";
    if (!questionText || questionText.length > 500) {
      return Response.json({ error: "question is required (max 500 characters)." }, { status: 400 });
    }
    data.question = questionText;
  }

  if (body?.choices !== undefined) {
    if (question.type !== "MULTIPLE_CHOICE" && question.type !== "MULTI_SELECT") {
      return Response.json(
        { error: "Only multiple-choice/multi-select questions support editing choice text." },
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

  if (body?.correctChoices !== undefined) {
    const choicePool = data.choices ?? question.choices;
    const rawCorrectChoices: unknown[] = Array.isArray(body.correctChoices) ? body.correctChoices : [];
    const stringCorrectChoices: string[] = rawCorrectChoices.filter(
      (choice): choice is string => typeof choice === "string"
    );
    const correctChoices = [...new Set(stringCorrectChoices)];
    const minRequired = question.type === "MULTI_SELECT" ? 2 : 1;
    const maxAllowed = question.type === "MULTI_SELECT" ? choicePool.length : 1;
    if (
      correctChoices.length < minRequired ||
      correctChoices.length > maxAllowed ||
      !correctChoices.every((choice) => choicePool.includes(choice))
    ) {
      return Response.json(
        {
          error:
            question.type === "MULTI_SELECT"
              ? "correctChoices must list at least two of the question's choices."
              : "correctChoices must contain exactly one of the question's choices.",
        },
        { status: 400 }
      );
    }
    data.correctChoices = correctChoices;
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

  await questionRef.update(data);
  const updatedSnap = await questionRef.get();
  const updated = updatedSnap.data()!;

  return Response.json({
    id: questionId,
    type: updated.type,
    question: updated.question,
    choices: updated.choices,
    correctChoices: updated.correctChoices,
    timeLimitSecs: updated.timeLimitSecs,
  });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; questionId: string }> }
) {
  const { id, questionId } = await params;

  const quizRef = firestore.collection("quizzes").doc(id);
  const questionsRef = quizRef.collection("questions");
  const questionRef = questionsRef.doc(questionId);

  const [quizSnap, questionSnap, countSnap] = await Promise.all([
    quizRef.get(),
    questionRef.get(),
    questionsRef.count().get(),
  ]);
  if (!questionSnap.exists) {
    return Response.json({ error: "Question not found." }, { status: 404 });
  }
  if (!quizSnap.exists) {
    return Response.json({ error: "Quiz not found." }, { status: 404 });
  }
  if (countSnap.data().count <= 1) {
    return Response.json({ error: "A quiz must have at least one question." }, { status: 400 });
  }

  // Question order must stay contiguous (0..n-1) — game sessions identify the
  // last question by `order === questions.length - 1`, which a gap would
  // break. Firestore transactions require every read before any write (the
  // original Prisma version interleaved delete-then-read-then-write, which
  // isn't expressible here) — validated against concurrent overlapping
  // deletes in the migration plan's Phase 2 spike
  // (scripts/firestore-spike/02-reorder-transaction.ts).
  await firestore.runTransaction(async (tx) => {
    const snap = await tx.get(questionsRef.orderBy("order"));
    const target = snap.docs.find((d) => d.id === questionId);
    if (!target) return; // already deleted by a concurrent request
    const deletedOrder = target.data().order as number;

    tx.delete(target.ref);
    for (const doc of snap.docs) {
      if (doc.id === questionId) continue;
      const order = doc.data().order as number;
      if (order > deletedOrder) {
        tx.update(doc.ref, { order: order - 1 });
      }
    }
  });

  return Response.json({ ok: true });
}
