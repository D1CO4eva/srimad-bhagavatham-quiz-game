import { db } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { gradeAnswer } from "@/lib/grading";
import { isAcceptingResponses } from "@/lib/quizSchedule";

type SubmittedAnswer = { questionId?: unknown; selectedChoices?: unknown };

function requiredString(value: unknown): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed === "" ? null : trimmed;
}

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const body = await request.json().catch(() => null);

  const quiz = await db.quiz.findUnique({
    where: { slug },
    select: {
      id: true,
      status: true,
      mode: true,
      responsesOpen: true,
      opensAt: true,
      closesAt: true,
      questions: {
        orderBy: { order: "asc" },
        select: { id: true, order: true, question: true, choices: true, correctChoices: true, explanation: true },
      },
    },
  });
  if (!quiz || quiz.mode !== "SELF_PACED") {
    return Response.json({ error: "Quiz not found." }, { status: 404 });
  }
  if (!isAcceptingResponses(quiz)) {
    return Response.json({ error: "This quiz is not currently accepting responses." }, { status: 403 });
  }

  const respondentName = requiredString(body?.name);
  const respondentEmail = requiredString(body?.email);
  const respondentPhone = requiredString(body?.phone);
  const respondentCountryCode = requiredString(body?.countryCode);
  const respondentRegNo = requiredString(body?.registrationNumber);
  if (!respondentName || !respondentEmail || !respondentPhone || !respondentCountryCode || !respondentRegNo) {
    return Response.json(
      { error: "Name, email, phone number, country code, and registration number are all required." },
      { status: 400 }
    );
  }

  const submittedAnswers: SubmittedAnswer[] = Array.isArray(body?.answers) ? body.answers : [];
  const selectedByQuestionId = new Map<string, string[]>();
  for (const entry of submittedAnswers) {
    if (typeof entry?.questionId !== "string") continue;
    const selected = Array.isArray(entry.selectedChoices)
      ? entry.selectedChoices.filter((c: unknown): c is string => typeof c === "string")
      : [];
    selectedByQuestionId.set(entry.questionId, selected);
  }

  const existing = await db.quizResponse.findUnique({
    where: { quizId_respondentRegNo: { quizId: quiz.id, respondentRegNo } },
    select: { id: true },
  });
  if (existing) {
    return Response.json({ error: "You've already submitted this quiz." }, { status: 409 });
  }

  const answerBreakdown = quiz.questions.map((question) => {
    const selectedChoices = selectedByQuestionId.get(question.id) ?? [];
    return {
      questionId: question.id,
      order: question.order,
      question: question.question,
      choices: question.choices,
      correctChoices: question.correctChoices,
      selectedChoices,
      correct: gradeAnswer(selectedChoices, question.correctChoices),
      explanation: question.explanation,
    };
  });
  const score = answerBreakdown.filter((a) => a.correct).length;

  try {
    const response = await db.quizResponse.create({
      data: {
        quizId: quiz.id,
        respondentName,
        respondentEmail,
        respondentPhone,
        respondentCountryCode,
        respondentRegNo,
        score,
        totalQuestions: quiz.questions.length,
        answers: answerBreakdown,
      },
      select: { id: true },
    });
    return Response.json({
      responseId: response.id,
      score,
      totalQuestions: quiz.questions.length,
      answers: answerBreakdown,
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return Response.json({ error: "You've already submitted this quiz." }, { status: 409 });
    }
    console.error("Unexpected error while submitting a quiz response:", error);
    return Response.json({ error: "Unexpected server error while submitting this quiz." }, { status: 500 });
  }
}
