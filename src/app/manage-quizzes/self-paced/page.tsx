import { firestore } from "@/lib/firestore";
import { GenerateQuizForm } from "@/app/host/GenerateQuizForm";
import { getCourseCatalog, toPublicCourseWeeks } from "@/lib/courseCatalog";
import { logoutHostAction } from "@/app/host/login/actions";
import { SelfPacedDraftCard } from "./SelfPacedDraftCard";
import { SelfPacedQuizCard } from "./SelfPacedQuizCard";

export const dynamic = "force-dynamic";

type QuizQuestion = {
  id: string;
  type: "MULTIPLE_CHOICE" | "TRUE_FALSE" | "SHORT_ANSWER" | "MULTI_SELECT";
  question: string;
  choices: string[];
  correctChoices: string[];
  timeLimitSecs: number;
};

async function withQuestions(doc: FirebaseFirestore.QueryDocumentSnapshot) {
  const questionsSnap = await doc.ref.collection("questions").orderBy("order").get();
  const questions: QuizQuestion[] = questionsSnap.docs.map((q) => {
    const data = q.data();
    return {
      id: q.id,
      type: data.type,
      question: data.question,
      choices: data.choices,
      correctChoices: data.correctChoices,
      timeLimitSecs: data.timeLimitSecs,
    };
  });
  return { data: doc.data(), questions };
}

export default async function SelfPacedDashboardPage() {
  const [catalog, draftsSnap, publishedSnap] = await Promise.all([
    getCourseCatalog(),
    firestore
      .collection("quizzes")
      .where("status", "==", "DRAFT")
      .where("mode", "==", "SELF_PACED")
      .orderBy("createdAt", "desc")
      .get(),
    firestore
      .collection("quizzes")
      .where("status", "==", "PUBLISHED")
      .where("mode", "==", "SELF_PACED")
      .orderBy("createdAt", "desc")
      .get(),
  ]);

  const drafts = await Promise.all(
    draftsSnap.docs.map(async (doc) => {
      const { data, questions } = await withQuestions(doc);
      return {
        id: doc.id,
        title: data.title as string,
        slug: (data.slug as string | null) ?? null,
        responsesOpen: data.responsesOpen as boolean,
        opensAt: data.opensAt?.toDate?.() ?? null,
        closesAt: data.closesAt?.toDate?.() ?? null,
        questions,
      };
    })
  );

  const published = await Promise.all(
    publishedSnap.docs.map(async (doc) => {
      const { data, questions } = await withQuestions(doc);
      const responseCountSnap = await doc.ref.collection("responses").count().get();
      return {
        id: doc.id,
        title: data.title as string,
        slug: (data.slug as string | null) ?? null,
        responsesOpen: data.responsesOpen as boolean,
        opensAt: (data.opensAt?.toDate?.() as Date | null) ?? null,
        closesAt: (data.closesAt?.toDate?.() as Date | null) ?? null,
        questionCount: questions.length,
        responseCount: responseCountSnap.data().count,
        questions,
      };
    })
  );

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-8 px-6 py-16 lg:max-w-4xl xl:max-w-5xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <span className="pill-badge">Host · Self-Paced</span>
          <h1 className="mt-3 text-4xl">Pick a quiz</h1>
          <p className="mt-2 text-ink-soft">
            Generate a new quiz, then publish it to get a shareable link students fill out on their own time.
          </p>
        </div>
        <form action={logoutHostAction}>
          <button type="submit" className="text-sm font-semibold text-ink-soft underline">
            Log out
          </button>
        </form>
      </div>

      <GenerateQuizForm weeks={toPublicCourseWeeks(catalog)} mode="SELF_PACED" />

      {drafts.length > 0 && (
        <div>
          <h2 className="text-2xl">Drafts</h2>
          <p className="mt-1 text-sm text-ink-soft">Review, rename, and publish before students can take these.</p>
          <ul className="mt-3 flex flex-col gap-3">
            {drafts.map((quiz) => (
              <SelfPacedDraftCard key={quiz.id} quiz={quiz} />
            ))}
          </ul>
        </div>
      )}

      <div>
        <h2 className="text-2xl">Published quizzes</h2>
        {published.length === 0 ? (
          <p className="mt-2 text-ink-soft">No published self-paced quizzes yet.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-3">
            {published.map((quiz) => (
              <SelfPacedQuizCard
                key={quiz.id}
                quiz={{
                  id: quiz.id,
                  title: quiz.title,
                  slug: quiz.slug,
                  responsesOpen: quiz.responsesOpen,
                  opensAt: quiz.opensAt ? quiz.opensAt.toISOString() : null,
                  closesAt: quiz.closesAt ? quiz.closesAt.toISOString() : null,
                  questionCount: quiz.questionCount,
                  responseCount: quiz.responseCount,
                  questions: quiz.questions,
                }}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
