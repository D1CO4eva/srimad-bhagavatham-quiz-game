// Extracts "PLAYER <id> <nickname>" lines from a join-burst.js log into a
// JSON array answer-burst.js can load. Usage:
//   node load-test/parse-players.mjs join-log.txt players.json
import { readFileSync, writeFileSync } from "node:fs";

const [, , logPath, outPath = "load-test/players.json"] = process.argv;
if (!logPath) {
  console.error("Usage: node load-test/parse-players.mjs <join-log.txt> [out.json]");
  process.exit(1);
}

const lines = readFileSync(logPath, "utf8").split("\n");
const players = lines
  .filter((line) => line.includes("PLAYER "))
  .map((line) => {
    // k6's log formatter wraps the message in a quote that isn't part of
    // the nickname itself: `msg="PLAYER <id> <nickname>" source=console`.
    const match = line.match(/PLAYER (\S+) (\S+)"/);
    return match ? { playerId: match[1], nickname: match[2] } : null;
  })
  .filter(Boolean);

writeFileSync(outPath, JSON.stringify(players, null, 2));
console.log(`Wrote ${players.length} players to ${outPath}`);
