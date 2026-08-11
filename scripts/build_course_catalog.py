#!/usr/bin/env python3
"""Convert this app's own copy of the Bhagavatam course notes/infographics
(course-materials/raw/week-N/...) into Markdown with MarkItDown, and build
src/data/courseCatalog.json — the local replacement for the shared
COURSE_CATALOG_URL catalog.

Topics are derived from each note PDF's numbered outline markers (e.g.
"4.2 Lineage of Srimad Bhagavatam"), which is the section-heading convention
these course handouts consistently use; MarkItDown's own heading detection
does not reliably pick these up without a vision model, which this repo does
not have configured.

Usage: python scripts/build_course_catalog.py
"""

from __future__ import annotations

import json
import re
from pathlib import Path

from markitdown import MarkItDown

ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / "course-materials" / "raw"
NOTES_OUT_DIR = ROOT / "content" / "course-notes"
CATALOG_OUT = ROOT / "src" / "data" / "courseCatalog.json"

WEEK_LABELS = {
    "week-1": "Week 1",
    "week-2": "Week 2",
    "week-3": "Week 3",
    "week-4": "Week 4",
    "week-5": "Week 5",
    "week-6": "Week 6",
}

HEADING_PATTERN = re.compile(r"^\d+\.\d+[ \t]+(.+?)[ \t]*$", re.MULTILINE)
IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp"}


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug or "document"


def normalize_topic(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def extract_topics(markdown: str) -> list[str]:
    seen: set[str] = set()
    topics: list[str] = []
    for match in HEADING_PATTERN.finditer(markdown):
        topic = normalize_topic(match.group(1))
        key = topic.lower()
        if topic and key not in seen:
            seen.add(key)
            topics.append(topic)
    return topics


def convert_document(converter: MarkItDown, path: Path, week_out_dir: Path) -> tuple[dict, list[str]]:
    is_image = path.suffix.lower() in IMAGE_SUFFIXES
    markdown = ""
    if not is_image:
        markdown = converter.convert(str(path)).text_content.strip()

    week_out_dir.mkdir(parents=True, exist_ok=True)
    md_path = week_out_dir / f"{slugify(path.stem)}.md"
    if is_image:
        md_path.write_text(
            f"# {path.name}\n\n"
            "Image asset — no OCR performed in this build (no vision model "
            "configured in this repo). The infographic is still included as "
            "a source document so it stays in the RAG retrieval scope once "
            "GOD-Auth-Service has it indexed with real OCR'd content.\n",
            encoding="utf-8",
        )
    else:
        md_path.write_text(markdown + "\n", encoding="utf-8")

    topics = [] if is_image else extract_topics(markdown)
    document = {
        "id": slugify(path.stem),
        "name": path.name,
        "topics_from_headings": topics,
    }
    return document, topics


def main() -> None:
    converter = MarkItDown(enable_plugins=False)
    weeks_out = []

    for week_id in sorted(WEEK_LABELS, key=lambda w: int(w.split("-")[1])):
        week_dir = RAW_DIR / week_id
        if not week_dir.is_dir():
            continue
        sources = sorted(p for p in week_dir.iterdir() if p.is_file())
        if not sources:
            continue

        week_out_dir = NOTES_OUT_DIR / week_id
        source_documents = []
        week_topics: list[str] = []
        seen_topic_keys: set[str] = set()

        for source in sources:
            document, topics = convert_document(converter, source, week_out_dir)
            source_documents.append(document)
            for topic in topics:
                key = topic.lower()
                if key not in seen_topic_keys:
                    seen_topic_keys.add(key)
                    week_topics.append(topic)

        weeks_out.append({
            "id": week_id,
            "label": WEEK_LABELS[week_id],
            "topics": week_topics,
            "source_documents": source_documents,
        })
        print(f"{week_id}: {len(source_documents)} documents, {len(week_topics)} topics")

    CATALOG_OUT.parent.mkdir(parents=True, exist_ok=True)
    CATALOG_OUT.write_text(
        json.dumps({"weeks": weeks_out}, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print(f"\nWrote {CATALOG_OUT}")


if __name__ == "__main__":
    main()
