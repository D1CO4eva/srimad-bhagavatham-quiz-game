// One-time Supabase Postgres -> Firestore migration (Phase 8 of the
// migration plan — see docs/firestore-migration.md).
//
// Only Quiz + Question + QuizResponse are migrated. GameSession/Player/
// Answer/SessionResult are intentionally NOT migrated — confirmed with the
// user that per-session history isn't surfaced anywhere in the host UI, so
// that data is disposable once a class ends (same judgment already made in
// the migration plan).
//
// Usage:
//   DATABASE_URL=$(gcloud secrets versions access latest --secret=DATABASE_URL --project=bhagavatham-quiz-game) \
//     npx tsx scripts/migrate-to-firestore/index.ts --dry-run
//   ...then without --dry-run to actually write to Firestore. Requires
//   FIRESTORE_EMULATOR_HOST to be UNSET (writes to the real project) and
//   `gcloud auth application-default login` to have been run.
import { Client } from "pg";
import { firestore } from "../../src/lib/firestore";

const DRY_RUN = process.argv.includes("--dry-run");

type QuizRow = {
  id: string;
  title: string;
  description: string;
  status: "DRAFT" | "PUBLISHED";
  mode: "LIVE" | "SELF_PACED";
  slug: string | null;
  responsesOpen: boolean;
  opensAt: Date | null;
  closesAt: Date | null;
  showLeaderboardDefault: boolean;
  showTimerDefault: boolean;
  scoringMode: "SPEED" | "ACCURACY";
  leadTimeSecs: number;
  createdAt: Date;
  updatedAt: Date;
};

async function main() {
  if (process.env.FIRESTORE_EMULATOR_HOST && !DRY_RUN) {
    throw new Error(
      "FIRESTORE_EMULATOR_HOST is set — refusing to run a real (non-dry-run) migration against the emulator. Unset it to write to the real project."
    );
  }

  const pg = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await pg.connect();

  const quizzes = (await pg.query<QuizRow>(`SELECT * FROM "Quiz" ORDER BY "createdAt" ASC`)).rows;
  console.log(`Found ${quizzes.length} quizzes to migrate.${DRY_RUN ? " (DRY RUN — no writes)" : ""}`);

  let totalQuestions = 0;
  let totalResponses = 0;

  for (const quiz of quizzes) {
    const questions = (
      await pg.query(`SELECT * FROM "Question" WHERE "quizId" = $1 ORDER BY "order" ASC`, [quiz.id])
    ).rows;
    const responses =
      quiz.mode === "SELF_PACED"
        ? (await pg.query(`SELECT * FROM "QuizResponse" WHERE "quizId" = $1`, [quiz.id])).rows
        : [];

    totalQuestions += questions.length;
    totalResponses += responses.length;

    console.log(
      `Quiz "${quiz.title}" (${quiz.status}/${quiz.mode}): ${questions.length} questions, ${responses.length} responses`
    );

    if (DRY_RUN) continue;

    const quizRef = firestore.collection("quizzes").doc();
    await quizRef.set({
      title: quiz.title,
      description: quiz.description,
      status: quiz.status,
      mode: quiz.mode,
      slug: quiz.slug,
      responsesOpen: quiz.responsesOpen,
      opensAt: quiz.opensAt,
      closesAt: quiz.closesAt,
      showLeaderboardDefault: quiz.showLeaderboardDefault,
      showTimerDefault: quiz.showTimerDefault,
      scoringMode: quiz.scoringMode,
      leadTimeSecs: quiz.leadTimeSecs,
      createdAt: quiz.createdAt,
      updatedAt: quiz.updatedAt,
    });

    const questionsRef = quizRef.collection("questions");
    const questionBatch = firestore.batch();
    for (const q of questions) {
      questionBatch.set(questionsRef.doc(), {
        order: q.order,
        type: q.type,
        question: q.question,
        choices: q.choices,
        correctChoices: q.correctChoices,
        explanation: q.explanation,
        timeLimitSecs: q.timeLimitSecs,
        quizCreatedAt: quiz.createdAt,
      });
    }
    if (questions.length > 0) await questionBatch.commit();

    if (responses.length > 0) {
      const crypto = await import("node:crypto");
      const responsesRef = quizRef.collection("responses");
      const responseBatch = firestore.batch();
      for (const r of responses) {
        const docId = crypto.createHash("sha256").update(r.respondentRegNo).digest("hex");
        responseBatch.set(responsesRef.doc(docId), {
          respondentName: r.respondentName,
          respondentEmail: r.respondentEmail,
          respondentPhone: r.respondentPhone,
          respondentCountryCode: r.respondentCountryCode,
          respondentRegNo: r.respondentRegNo,
          score: r.score,
          totalQuestions: r.totalQuestions,
          answers: r.answers,
          submittedAt: r.submittedAt,
        });
      }
      await responseBatch.commit();
    }
  }

  await pg.end();

  console.log(
    `\n${DRY_RUN ? "Would migrate" : "Migrated"}: ${quizzes.length} quizzes, ${totalQuestions} questions, ${totalResponses} responses.`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
