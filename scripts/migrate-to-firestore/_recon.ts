// Read-only reconnaissance against prod Supabase before writing the real
// migration script — just row counts, no data printed (some of this is
// student PII).
import { Client } from "pg";

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();

  const tables = ["Quiz", "Question", "GameSession", "Player", "GameSessionQuestion", "Answer", "SessionResult", "QuizResponse"];
  for (const table of tables) {
    const res = await client.query(`SELECT COUNT(*) FROM "${table}"`);
    console.log(`${table}: ${res.rows[0].count} rows`);
  }

  const statusBreakdown = await client.query(`SELECT status, mode, COUNT(*) FROM "Quiz" GROUP BY status, mode`);
  console.log("Quiz breakdown by status/mode:", statusBreakdown.rows);

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
