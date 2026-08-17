import crypto from "node:crypto";
import { firestore } from "@/lib/firestore";
import { gradeAnswer } from "@/lib/grading";
import { isAcceptingResponses } from "@/lib/quizSchedule";

type SubmittedAnswer = { questionId?: unknown; selectedChoices?: unknown };

function requiredString(value: unknown): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed === "" ? null : trimmed;
}

/** Firestore doc IDs can't contain "/" and have other validity constraints
 * a free-text registration number could violate — hashing it sidesteps all
 * of that while staying deterministic (same regNo always maps to the same
 * doc, giving the [quizId, respondentRegNo] uniqueness for free via
 * Firestore's own doc-ID-exists check). The human-readable value is still
 * stored as a field for display. */
function responseDocId(respondentRegNo: string): string {
  return crypto.createHash("sha256").update(respondentRegNo).digest("hex");
}

// gRPC status code 6 (ALREADY_EXISTS) — what create() throws against an
// existing doc path, confirmed against the emulator. The Firestore
// equivalent of Prisma's P2002 unique-constraint-violation code.
const FIRESTORE_ALREADY_EXISTS = 6;

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const body = await request.json().catch(() => null);

  const quizSnap = await firestore.collection("quizzes").where("slug", "==", slug).limit(1).get();
  if (quizSnap.empty) {
    return Response.json({ error: "Quiz not found." }, { status: 404 });
  }
  const quizDoc = quizSnap.docs[0];
  const quiz = quizDoc.data();
  if (quiz.mode !== "SELF_PACED") {
    return Response.json({ error: "Quiz not found." }, { status: 404 });
  }
  const scheduleGate = {
    status: quiz.status,
    mode: quiz.mode,
    responsesOpen: quiz.responsesOpen,
    opensAt: quiz.opensAt?.toDate?.() ?? null,
    closesAt: quiz.closesAt?.toDate?.() ?? null,
  };
  if (!isAcceptingResponses(scheduleGate)) {
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

  const questionsSnap = await quizDoc.ref.collection("questions").orderBy("order").get();
  const answerBreakdown = questionsSnap.docs.map((doc) => {
    const question = doc.data();
    const selectedChoices = selectedByQuestionId.get(doc.id) ?? [];
    return {
      questionId: doc.id,
      order: question.order as number,
      question: question.question as string,
      choices: question.choices as string[],
      correctChoices: question.correctChoices as string[],
      selectedChoices,
      correct: gradeAnswer(selectedChoices, question.correctChoices),
      explanation: question.explanation as string,
    };
  });
  const score = answerBreakdown.filter((a) => a.correct).length;

  const responseRef = quizDoc.ref.collection("responses").doc(responseDocId(respondentRegNo));
  try {
    await responseRef.create({
      respondentName,
      respondentEmail,
      respondentPhone,
      respondentCountryCode,
      respondentRegNo,
      score,
      totalQuestions: questionsSnap.size,
      answers: answerBreakdown,
      submittedAt: new Date(),
    });
    return Response.json({
      responseId: responseRef.id,
      score,
      totalQuestions: questionsSnap.size,
      answers: answerBreakdown,
    });
  } catch (error) {
    // Firestore's create() fails atomically if the doc already exists — the
    // ALREADY_EXISTS case is the Firestore equivalent of Prisma's P2002,
    // no separate existence pre-check needed first.
    if (error && typeof error === "object" && "code" in error && error.code === FIRESTORE_ALREADY_EXISTS) {
      return Response.json({ error: "You've already submitted this quiz." }, { status: 409 });
    }
    console.error("Unexpected error while submitting a quiz response:", error);
    return Response.json({ error: "Unexpected server error while submitting this quiz." }, { status: 500 });
  }
}
