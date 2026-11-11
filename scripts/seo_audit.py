#!/usr/bin/env python3
"""Static SEO checks for the GitHub Pages repository (standard library only)."""
from __future__ import annotations

from collections import defaultdict
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit, unquote
import re
from datetime import date
import json
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
SITE = "https://ivanivorontsov-sudo.github.io"
SITEMAP = ROOT / "sitemap.xml"
ROBOTS = ROOT / "robots.txt"
REMOTE_PREFIXES = (
    "vizitka/",
    "edinicy/",
    "tools-portal/",
    "supersmart-privacy/",
)
ERRORS: list[str] = []
WARNINGS: list[str] = []


def error(message: str) -> None:
    ERRORS.append(message)


def warning(message: str) -> None:
    WARNINGS.append(message)


class PageParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.title_values: list[str] = []
        self.h1_count = 0
        self.ids: set[str] = set()
        self.duplicate_ids: set[str] = set()
        self.links: list[str] = []
        self.metas: dict[str, list[str]] = defaultdict(list)
        self.properties: dict[str, list[str]] = defaultdict(list)
        self.canonicals: list[str] = []
        self.jsonld: list[str] = []
        self._title = False
        self._title_buffer = ""
        self._script_jsonld = False
        self._script_buffer = ""

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        a = {k.lower(): (v or "") for k, v in attrs}
        if "id" in a:
            if a["id"] in self.ids:
                self.duplicate_ids.add(a["id"])
            self.ids.add(a["id"])
        if tag.lower() == "title":
            self._title = True
            self._title_buffer = ""
        if tag.lower() == "h1":
            self.h1_count += 1
        if tag.lower() == "meta":
            name = a.get("name", "").lower()
            prop = a.get("property", "").lower()
            if name:
                self.metas[name].append(a.get("content", ""))
            if prop:
                self.properties[prop].append(a.get("content", ""))
        if tag.lower() == "link" and a.get("rel", "").lower() == "canonical":
            self.canonicals.append(a.get("href", ""))
        if tag.lower() in ("a", "img", "script", "link", "source", "video", "audio"):
            candidate = a.get("href") or a.get("src") or a.get("poster")
            if candidate:
                self.links.append(candidate)
        if tag.lower() == "script" and a.get("type", "").lower() == "application/ld+json":
            self._script_jsonld = True
            self._script_buffer = ""

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() == "title" and self._title:
            self.title_values.append(re.sub(r"\s+", " ", self._title_buffer).strip())
            self._title = False
        if tag.lower() == "script" and self._script_jsonld:
            self.jsonld.append(self._script_buffer.strip())
            self._script_jsonld = False

    def handle_data(self, data: str) -> None:
        if self._title:
            self._title_buffer += data
        if self._script_jsonld:
            self._script_buffer += data


def expected_canonical(path: Path) -> str:
    rel = path.relative_to(ROOT).as_posix()
    if rel == "index.html":
        return SITE + "/"
    if rel.endswith("/index.html"):
        return SITE + "/" + rel[:-len("index.html")]
    return SITE + "/" + rel


def is_remote_pages_path(path: str) -> bool:
    normalized = path.lstrip("/")
    return any(normalized.startswith(prefix) for prefix in REMOTE_PREFIXES)


def resolve_local_link(link: str, page: Path) -> Path | None:
    parts = urlsplit(link)
    if parts.scheme or parts.netloc:
        if parts.scheme in ("mailto", "tel", "data", "javascript", "blob"):
            return None
        if parts.hostname and parts.hostname.lower() != "ivanivorontsov-sudo.github.io":
            return None
        path_text = unquote(parts.path)
        if is_remote_pages_path(path_text):
            return None
        candidate = ROOT / path_text.lstrip("/")
    else:
        path_text = unquote(parts.path)
        if not path_text:
            return None
        candidate = (ROOT / path_text.lstrip("/")) if path_text.startswith("/") else (page.parent / path_text)
    candidate = candidate.resolve()
    try:
        candidate.relative_to(ROOT.resolve())
    except ValueError:
        return None
    if candidate.is_dir():
        candidate = candidate / "index.html"
    if candidate.is_file():
        return candidate
    if not candidate.suffix:
        if candidate.with_suffix(".html").is_file():
            return candidate.with_suffix(".html")
        if (candidate / "index.html").is_file():
            return candidate / "index.html"
    return candidate


def check_page(path: Path, seen_canonicals: dict[str, Path]) -> None:
    parser = PageParser()
    try:
        parser.feed(path.read_text(encoding="utf-8"))
        parser.close()
    except Exception as exc:
        error(f"{path.relative_to(ROOT)}: HTML parse failed: {exc}")
        return

    rel = path.relative_to(ROOT).as_posix()
    if rel == "404.html":
        if "noindex" not in ",".join(parser.metas.get("robots", [])).lower():
            error("404.html: missing robots noindex")
        return

    if len(parser.title_values) != 1 or not parser.title_values[0]:
        error(f"{rel}: expected exactly one non-empty title, found {len(parser.title_values)}")
    else:
        title = parser.title_values[0]
        if len(title) > 70:
            warning(f"{rel}: title is long ({len(title)} characters)")

    descriptions = parser.metas.get("description", [])
    if len(descriptions) != 1 or not descriptions[0].strip():
        error(f"{rel}: expected exactly one non-empty meta description, found {len(descriptions)}")
    elif len(descriptions[0].strip()) < 70 or len(descriptions[0].strip()) > 180:
        warning(f"{rel}: meta description length is {len(descriptions[0].strip())} characters")

    if parser.h1_count != 1:
        error(f"{rel}: expected exactly one H1, found {parser.h1_count}")

    if len(parser.canonicals) != 1 or not parser.canonicals[0]:
        error(f"{rel}: expected exactly one canonical URL, found {len(parser.canonicals)}")
    else:
        canonical = parser.canonicals[0].strip()
        expected = expected_canonical(path)
        if canonical != expected:
            error(f"{rel}: canonical mismatch; expected {expected}, got {canonical}")
        if canonical in seen_canonicals:
            error(f"{rel}: duplicate canonical also used by {seen_canonicals[canonical].relative_to(ROOT)}")
        else:
            seen_canonicals[canonical] = path

    for key in ("og:title", "og:description", "og:url"):
        values = parser.properties.get(key, [])
        if len(values) != 1 or not values[0].strip():
            error(f"{rel}: expected one non-empty {key}")
    for key in ("twitter:card", "twitter:title", "twitter:description"):
        values = parser.metas.get(key, [])
        if len(values) != 1 or not values[0].strip():
            error(f"{rel}: expected one non-empty {key}")

    if parser.canonicals and parser.properties.get("og:url"):
        if parser.properties["og:url"][0].strip() != parser.canonicals[0].strip():
            error(f"{rel}: og:url does not match canonical URL")

    for raw in parser.jsonld:
        try:
            json.loads(raw)
        except Exception as exc:
            error(f"{rel}: invalid JSON-LD: {exc}")

    for duplicate in sorted(parser.duplicate_ids):
        warning(f"{rel}: duplicate id='{duplicate}'")

    for link in parser.links:
        if link.startswith("#"):
            continue
        target = resolve_local_link(link, path)
        if target is not None and not target.exists():
            error(f"{rel}: broken local link '{link}' -> {target.relative_to(ROOT)}")


def check_sitemap(indexable: set[str]) -> None:
    if not SITEMAP.is_file():
        error("sitemap.xml is missing")
        return
    try:
        root = ET.parse(SITEMAP).getroot()
    except Exception as exc:
        error(f"sitemap.xml: XML parse failed: {exc}")
        return
    locs: list[str] = []
    for node in root.findall("{*}url"):
        loc = node.findtext("{*}loc", default="").strip()
        if not loc:
            error("sitemap.xml: <url> without <loc>")
            continue
        locs.append(loc)
        lastmod = node.findtext("{*}lastmod", default="").strip()
        if lastmod:
            try:
                date.fromisoformat(lastmod[:10])
            except ValueError:
                error(f"sitemap.xml: invalid lastmod '{lastmod}' for {loc}")
    if len(locs) != len(set(locs)):
        error("sitemap.xml: duplicate <loc> entries")
    listed = set(locs)

    for url in listed:
        parts = urlsplit(url)
        if parts.hostname and parts.hostname.lower() == "ivanivorontsov-sudo.github.io":
            if is_remote_pages_path(parts.path):
                continue
            path_text = unquote(parts.path).lstrip("/")
            candidate = ROOT / path_text if path_text else ROOT / "index.html"
            if candidate.is_dir():
                candidate = candidate / "index.html"
            if not candidate.is_file() and not candidate.suffix:
                candidate = candidate / "index.html"
            if not candidate.is_file():
                error(f"sitemap.xml: local URL has no file: {url}")

    missing = sorted(indexable - listed)
    for url in missing:
        error(f"sitemap.xml: indexable local page is missing: {url}")


def main() -> int:
    html_files = sorted(p for p in ROOT.rglob("*.html") if ".git" not in p.parts)
    if not html_files:
        error("No HTML files found")
    seen: dict[str, Path] = {}
    indexable: set[str] = set()
    for path in html_files:
        check_page(path, seen)
        if path.name != "404.html":
            parser = PageParser()
            parser.feed(path.read_text(encoding="utf-8"))
            robots = ",".join(parser.metas.get("robots", [])).lower()
            if "noindex" not in robots:
                indexable.add(expected_canonical(path))

    if not ROBOTS.is_file() or "sitemap.xml" not in ROBOTS.read_text(encoding="utf-8"):
        error("robots.txt must advertise sitemap.xml")

    check_sitemap(indexable)

    print(f"Checked {len(html_files)} HTML pages.")
    if WARNINGS:
        print(f"Warnings: {len(WARNINGS)}")
        for item in WARNINGS:
            print("WARN:", item)
    if ERRORS:
        print(f"Errors: {len(ERRORS)}")
        for item in ERRORS:
            print("ERROR:", item)
        return 1
    print("SEO audit passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
