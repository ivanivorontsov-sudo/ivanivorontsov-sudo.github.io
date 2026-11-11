#!/usr/bin/env python3
"""Check the generated static workshop: 100 pages, 1,000 unique tools."""
from pathlib import Path
import re
import sys
ROOT=Path(__file__).resolve().parents[1]
W=ROOT/"tools-audit"/"workshop"
legacy=sorted(W.glob("*/index.html"))
converters=sorted(W.glob("converters/*/*/index.html"))
old_ids=[]; new_ids=[]
for p in legacy:
    old_ids += re.findall(r'class="tool" data-id="([^"]+)"',p.read_text(encoding="utf-8"))
for p in converters:
    src=p.read_text(encoding="utf-8")
    new_ids += re.findall(r'class="convert-tool"[^>]*data-tool-id="([^"]+)"',src)
    for x in re.findall(r'data-(?:source|target)-factor="([^"]+)"',src):
        try:
            if float(x)<=0: raise ValueError
        except ValueError: raise SystemExit(f"Invalid conversion factor in {p}: {x}")
errors=[]
if len(legacy)!=10: errors.append(f"Expected 10 legacy category pages; found {len(legacy)}")
if len(old_ids)!=100 or len(set(old_ids))!=100: errors.append(f"Expected 100 unique legacy tools; found {len(old_ids)} entries and {len(set(old_ids))} IDs")
if len(converters)!=90: errors.append(f"Expected 90 converter pages; found {len(converters)}")
if len(new_ids)!=900 or len(set(new_ids))!=900: errors.append(f"Expected 900 unique converters; found {len(new_ids)} entries and {len(set(new_ids))} IDs")
if len(legacy)+len(converters)!=100: errors.append(f"Expected 100 pages; found {len(legacy)+len(converters)}")
if len(old_ids)+len(new_ids)!=1000: errors.append(f"Expected 1,000 tools; found {len(old_ids)+len(new_ids)}")
if errors:
    print("\n".join("ERROR: "+x for x in errors)); sys.exit(1)
print(f"Workshop inventory passed: {len(legacy)+len(converters)} pages, {len(old_ids)+len(new_ids)} unique tools.")
