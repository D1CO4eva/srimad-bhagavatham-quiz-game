#!/usr/bin/env node
// Bundles content/course-notes/**/*.md (MarkItDown output, see
// build_course_catalog.py) into src/data/courseNotes.json — a doc-id ->
// text map keyed the same way as courseCatalog.json's source_documents[].id,
// so the app can import it as a static module (same pattern as
// courseCatalog.json) instead of reading the filesystem at request time,
// which Next.js's standalone build output wouldn't reliably trace.
//
// Usage: node scripts/build_course_notes.mjs

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const NOTES_DIR = join(ROOT, "content", "course-notes");
const OUT_FILE = join(ROOT, "src", "data", "courseNotes.json");

// Hand-transcribed infographic .md files (see build_course_catalog.py's
// MANUAL_TRANSCRIPTION_MARKER) start with an HTML comment marking them as
// such, purely for that script's own bookkeeping — it's not course content,
// so strip it here before the text reaches a generation prompt.
const MANUAL_TRANSCRIPTION_MARKER = /^<!--\s*manually-transcribed[^]*?-->\s*/;

const notes = {};
for (const weekDir of readdirSync(NOTES_DIR, { withFileTypes: true })) {
  if (!weekDir.isDirectory()) continue;
  const weekPath = join(NOTES_DIR, weekDir.name);
  for (const file of readdirSync(weekPath)) {
    if (!file.endsWith(".md")) continue;
    const docId = basename(file, ".md");
    const raw = readFileSync(join(weekPath, file), "utf8");
    notes[docId] = raw.replace(MANUAL_TRANSCRIPTION_MARKER, "").trim();
  }
}

writeFileSync(OUT_FILE, JSON.stringify(notes, null, 2) + "\n");
console.log(`Wrote ${Object.keys(notes).length} documents to ${OUT_FILE}`);
