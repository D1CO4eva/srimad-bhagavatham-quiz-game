#!/usr/bin/env node
// Fetches HH Sri Sri Muralidhara Swamiji's "thought for the day" quotes from
// godivinity.org's public WP REST API (quoteauthor=274 is his author term)
// and bundles them into src/data/swamijiQuotes.json — a static module the
// app reads at request time to show a quote between quiz questions (see
// src/lib/swamijiQuotes.ts), same pattern as build_course_notes.mjs.
//
// Quotes are filtered to MAX_QUOTE_LENGTH characters so each one is readable
// in the few seconds it's shown on screen; the source has some much longer
// reflections that don't fit that format.
//
// Usage: node scripts/build_swamiji_quotes.mjs

import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_FILE = join(ROOT, "src", "data", "swamijiQuotes.json");
const API_URL = "https://godivinity.org/wp-json/wp/v2/tftd?quoteauthor=274&per_page=100";
const MAX_QUOTE_LENGTH = 250;
// The source's free-text attribution has inconsistent capitalization/typos
// ("Murlaidhara", missing "Sri Sri") across entries — normalized to one
// canonical byline so the in-app display is consistent.
const CANONICAL_ATTRIBUTION = "HH Maharanyam Sri Sri Muralidhara Swamiji";

function decodeEntities(str) {
  return str
    .replace(/&#8217;/g, "’")
    .replace(/&#8216;/g, "‘")
    .replace(/&#8220;/g, "“")
    .replace(/&#8221;/g, "”")
    .replace(/&#8211;/g, "–")
    .replace(/&#8212;/g, "—")
    .replace(/&#038;/g, "&")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ");
}

function cleanHtml(html) {
  return decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/?p>/gi, "")
      .trim()
  ).replace(/\n+/g, "\n").trim();
}

async function fetchAllPages() {
  const items = [];
  let page = 1;
  while (true) {
    const response = await fetch(`${API_URL}&page=${page}`);
    if (!response.ok) throw new Error(`${API_URL}&page=${page} -> HTTP ${response.status}`);
    const pageItems = await response.json();
    items.push(...pageItems);
    const totalPages = Number(response.headers.get("X-WP-TotalPages") ?? "1");
    if (page >= totalPages) break;
    page += 1;
  }
  return items;
}

const rawItems = await fetchAllPages();

const quotes = rawItems
  .map((item) => {
    const cleaned = cleanHtml(item.content.rendered);
    const lastPipe = cleaned.lastIndexOf("|");
    const quote = lastPipe === -1 ? cleaned : cleaned.slice(0, lastPipe).trim();
    return { id: item.id, quote };
  })
  .filter((entry) => entry.quote.length > 0 && entry.quote.length <= MAX_QUOTE_LENGTH)
  .map((entry) => ({ ...entry, attribution: CANONICAL_ATTRIBUTION }));

writeFileSync(OUT_FILE, JSON.stringify(quotes, null, 2) + "\n");
console.log(`Wrote ${quotes.length} quotes (of ${rawItems.length} fetched) to ${OUT_FILE}`);
