#!/usr/bin/env python3
"""Generate a deterministic sitemap for the static GitHub Pages site."""
from __future__ import annotations
import argparse
from datetime import date
from html.parser import HTMLParser
from pathlib import Path
import subprocess
import difflib
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
SITE = "https://ivanivorontsov-sudo.github.io"
SITEMAP = ROOT / "sitemap.xml"
REMOTE_PREFIXES = ("/vizitka/", "/edinicy/", "/pdf-master/", "/daily-tools/", "/tools-portal/", "/supersmart-privacy/")
SKIP_PARTS = {".git", ".github", "node_modules", "__pycache__", "vendor"}
NS = "http://www.sitemaps.org/schemas/sitemap/0.9"
ET.register_namespace("", NS)

class MetaParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.robots = ""
        self.canonical = ""
    def handle_starttag(self, tag, attrs):
        a = {k.lower(): (v or "").strip() for k, v in attrs}
        if tag.lower() == "meta" and a.get("name", "").lower() == "robots":
            self.robots = a.get("content", "")
        elif tag.lower() == "link" and "canonical" in a.get("rel", "").lower().split():
            self.canonical = a.get("href", "")

def expected_url(path: Path) -> str:
    rel = path.relative_to(ROOT).as_posix()
    if rel == "index.html":
        return SITE + "/"
    if rel.endswith("/index.html"):
        return SITE + "/" + rel[:-len("index.html")]
    return SITE + "/" + rel

def git_lastmod(path: Path) -> str:
    rel = path.relative_to(ROOT).as_posix()
    try:
        result = subprocess.run(["git", "log", "-1", "--format=%cs", "--", rel], cwd=ROOT, capture_output=True, text=True, timeout=10)
        value = result.stdout.strip()
        if len(value) == 10:
            date.fromisoformat(value)
            return value
    except (OSError, ValueError, subprocess.TimeoutExpired):
        pass
    return date.today().isoformat()

def read_existing() -> dict[str, str]:
    out = {}
    if not SITEMAP.is_file():
        return out
    try:
        root = ET.parse(SITEMAP).getroot()
    except ET.ParseError:
        return out
    for node in root.findall(f"{{{NS}}}url"):
        loc = node.findtext(f"{{{NS}}}loc", default="").strip()
        lastmod = node.findtext(f"{{{NS}}}lastmod", default="").strip()[:10]
        if loc:
            out[loc] = lastmod
    return out

def build() -> str:
    previous = read_existing()
    entries = {}
    for url, modified in previous.items():
        path = url.removeprefix(SITE)
        if any(path.startswith(prefix) for prefix in REMOTE_PREFIXES):
            entries[url] = modified or date.today().isoformat()
    for page in sorted(ROOT.rglob("*.html")):
        rel = page.relative_to(ROOT)
        if any(part in SKIP_PARTS for part in rel.parts) or page.name == "404.html" or "tools-audit/workshop/converters/" in rel.as_posix():
            continue
        parser = MetaParser()
        try:
            parser.feed(page.read_text(encoding="utf-8"))
            parser.close()
        except (OSError, UnicodeError):
            continue
        if "noindex" in parser.robots.lower():
            continue
        url = expected_url(page)
        if parser.canonical and parser.canonical.strip() != url:
            continue
        modified = git_lastmod(page)
        old = previous.get(url, "")
        if old and old > modified:
            modified = old
        entries[url] = modified
    root = ET.Element(f"{{{NS}}}urlset")
    for url in sorted(entries):
        node = ET.SubElement(root, f"{{{NS}}}url")
        ET.SubElement(node, f"{{{NS}}}loc").text = url
        if entries[url]:
            ET.SubElement(node, f"{{{NS}}}lastmod").text = entries[url]
    ET.indent(root, space="  ")
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + ET.tostring(root, encoding="unicode") + "\n"

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()
    generated = build()
    if args.check:
        current_root = ET.parse(SITEMAP).getroot() if SITEMAP.is_file() else None
        generated_root = ET.fromstring(generated)
        current_urls = {
            node.findtext(f"{{{NS}}}loc", default="").strip()
            for node in current_root.findall(f"{{{NS}}}url")
        } if current_root is not None else set()
        generated_urls = {
            node.findtext(f"{{{NS}}}loc", default="").strip()
            for node in generated_root.findall(f"{{{NS}}}url")
        }
        if current_urls != generated_urls:
            print("sitemap.xml URL inventory is stale. Run: python3 scripts/generate_sitemap.py")
            for url in sorted(generated_urls - current_urls):
                print("MISSING:", url)
            for url in sorted(current_urls - generated_urls):
                print("UNEXPECTED:", url)
            return 1
        print(f"Sitemap URL inventory passed ({len(current_urls)} URLs). lastmod values are generated from git history by the write mode.")
        return 0
    SITEMAP.write_text(generated, encoding="utf-8")
    print(f"Updated sitemap.xml ({generated.count('<loc>')} URLs).")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
