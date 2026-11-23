#!/usr/bin/env python3
"""Notify IndexNow participants about changed indexable HTML URLs."""
from __future__ import annotations
from html.parser import HTMLParser
from pathlib import Path
import json, os, re, subprocess, sys, urllib.error, urllib.request

ROOT = Path(__file__).resolve().parents[1]
SITE = "https://ivanivorontsov-sudo.github.io"
HOST = "ivanivorontsov-sudo.github.io"
ENDPOINT = "https://api.indexnow.org/indexnow"
KEY_FILES = [p for p in ROOT.glob("*.txt") if re.fullmatch(r"[0-9a-fA-F]{32}\.txt", p.name)]

class Meta(HTMLParser):
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

def canonical_of(source: str):
    if not source:
        return None
    p = Meta()
    p.feed(source)
    if "noindex" in p.robots.lower():
        return None
    value = p.canonical.strip()
    return value if value == SITE + "/" or value.startswith(SITE + "/") else None

def git_show(rev, path):
    r = subprocess.run(["git", "show", f"{rev}:{path}"], cwd=ROOT, capture_output=True, text=True)
    return r.stdout if r.returncode == 0 else ""

def main() -> int:
    if len(KEY_FILES) != 1:
        print(f"Expected exactly one 32-hex IndexNow key file; found {len(KEY_FILES)}.", file=sys.stderr)
        return 1
    key_file = KEY_FILES[0]
    key = key_file.stem
    if key_file.read_text(encoding="utf-8").strip() != key:
        print("IndexNow key file content does not match its filename.", file=sys.stderr)
        return 1
    before = os.environ.get("GITHUB_EVENT_BEFORE", "")
    head = os.environ.get("GITHUB_SHA", "")
    if not before or not head or set(before) == {"0"}:
        print("Initial push: IndexNow notification skipped.")
        return 0
    diff = subprocess.run(["git", "diff", "--name-status", before, head, "--", "*.html"], cwd=ROOT, capture_output=True, text=True)
    if diff.returncode:
        print(diff.stderr, file=sys.stderr)
        return 1
    urls = []
    for row in diff.stdout.splitlines():
        fields = row.split("\t")
        status = fields[0]
        changes = [("D", fields[1]), ("A", fields[2])] if status.startswith("R") and len(fields) == 3 else [(status[0], fields[1])] if len(fields) > 1 else []
        for action, path in changes:
            if not path.lower().endswith(".html"):
                continue
            source = git_show(before, path) if action == "D" else (ROOT / path).read_text(encoding="utf-8", errors="replace") if (ROOT / path).is_file() else ""
            url = canonical_of(source)
            if url:
                urls.append(url)
    urls = sorted(set(urls))[:100]
    if not urls:
        print("No changed indexable HTML URLs to submit.")
        return 0
    payload = {"host": HOST, "key": key, "keyLocation": f"{SITE}/{key_file.name}", "urlList": urls}
    request = urllib.request.Request(ENDPOINT, data=json.dumps(payload).encode(), headers={"Content-Type":"application/json; charset=utf-8"}, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            print(f"IndexNow accepted: HTTP {response.status}; URLs submitted: {len(urls)}.")
            return 0 if response.status in (200, 202) else 1
    except urllib.error.HTTPError as exc:
        print(f"IndexNow HTTP {exc.code}: {exc.read(1000).decode('utf-8','replace')}", file=sys.stderr)
        return 1
    except (OSError, TimeoutError) as exc:
        print(f"IndexNow request failed: {exc}", file=sys.stderr)
        return 1

if __name__ == "__main__":
    raise SystemExit(main())
