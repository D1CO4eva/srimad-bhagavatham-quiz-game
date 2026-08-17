import { notFound } from "next/navigation";
import { firestore } from "@/lib/firestore";
import { describeWindowState } from "@/lib/quizSchedule";
import { TakeQuizForm } from "./TakeQuizForm";

export const dynamic = "force-dynamic";

export default async function TakeQuizPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const quizSnap = await firestore.collection("quizzes").where("slug", "==", slug).limit(1).get();
  if (quizSnap.empty) {
    notFound();
  }
  const quizDoc = quizSnap.docs[0];
  const quiz = quizDoc.data();

  if (quiz.mode !== "SELF_PACED" || quiz.status !== "PUBLISHED") {
    notFound();
  }

  const opensAt: Date | null = quiz.opensAt?.toDate?.() ?? null;
  const closesAt: Date | null = quiz.closesAt?.toDate?.() ?? null;
  const windowState = describeWindowState({
    status: quiz.status,
    mode: quiz.mode,
    responsesOpen: quiz.responsesOpen,
    opensAt,
    closesAt,
  });

  if (windowState !== "open") {
    const message =
      windowState === "not_open_yet"
        ? `This quiz opens on ${opensAt?.toLocaleString()}.`
        : windowState === "closed_by_window"
          ? `This quiz closed on ${closesAt?.toLocaleString()}.`
          : "This quiz has been closed by the host.";
    return (
      <div className="mx-auto flex min-h-screen w-full max-w-lg flex-col justify-center gap-4 px-6 py-16 text-center lg:max-w-xl">
        <h1 className="text-3xl">{quiz.title}</h1>
        <p className="text-ink-soft">{message}</p>
      </div>
    );
  }

  const questionsSnap = await quizDoc.ref.collection("questions").orderBy("order").get();
  const questions = questionsSnap.docs.map((doc) => {
    const data = doc.data();
    return { id: doc.id, order: data.order, type: data.type, question: data.question, choices: data.choices };
  });

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-8 px-6 py-16 lg:max-w-3xl xl:max-w-4xl">
      <TakeQuizForm slug={slug} title={quiz.title} description={quiz.description} questions={questions} />
    </div>
  );
}
