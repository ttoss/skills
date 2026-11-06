#!/usr/bin/env python3
"""List the headings other files point at, and the pointers a rewrite broke.

Usage: python3 heading_refs.py [repo_root] [--base <git ref>] [--json]

A pointer is `` `path/to/file.md` → "Heading" `` (also `->`), in Markdown or in
a code comment. Each is resolved to a file: the path as written, relative to
the referrer, by basename under `.claude/rules` and `internal/rules`, under
`packages/`, or, for a bare `CLAUDE.md` in code, the nearest `CLAUDE.md` above
the referrer. The heading matches when its text (trailing ellipsis dropped)
occurs in the target, case-insensitively, so a bold lead-in counts too.

Without `--base`: every resolved pointer, grouped by target, so an editor knows
which headings to keep. With `--base`: only the pointers that resolved in the
base revision (`git show <base>:<target>`) and no longer do in the working
tree — the ones a rewrite broke. Exit code 1 when any are reported.

Stdlib only; reads `git ls-files` when available, otherwise walks the tree.
"""
import json
import os
import re
import subprocess
import sys
from collections import defaultdict

SKIP_DIRS = {".git", "node_modules", "dist", "build", ".turbo", ".next", "coverage"}
TEXT_EXT = {".md", ".mdx", ".ts", ".tsx", ".js", ".mjs", ".cjs", ".py", ".go", ".rs", ".java", ".rb"}
POINTER = re.compile(r"`([^`\n]+?\.md)`\s*(?:→|->)\s*\"([^\"\n]+)\"")


def list_files(root):
    try:
        out = subprocess.run(
            ["git", "-C", root, "ls-files"], capture_output=True, text=True, check=True
        ).stdout
        files = [f for f in out.splitlines() if f]
        if files:
            return files
    except (OSError, subprocess.CalledProcessError):
        pass
    files = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for name in filenames:
            files.append(os.path.relpath(os.path.join(dirpath, name), root))
    return files


def read(root, rel):
    try:
        with open(os.path.join(root, rel), encoding="utf-8", errors="replace") as f:
            return f.read()
    except OSError:
        return None


def read_at(root, ref, rel):
    try:
        return subprocess.run(
            ["git", "-C", root, "show", f"{ref}:{rel}"],
            capture_output=True,
            text=True,
            check=True,
        ).stdout
    except (OSError, subprocess.CalledProcessError):
        return None


def candidates(referrer, target):
    base = os.path.basename(target)
    out = []
    if target == "CLAUDE.md":
        d = os.path.dirname(referrer)
        while d:
            out.append(os.path.join(d, "CLAUDE.md"))
            d = os.path.dirname(d)
    out += [target, os.path.normpath(os.path.join(os.path.dirname(referrer), target))]
    out += [
        os.path.join(".claude/rules", base),
        os.path.join("internal/rules", base),
        os.path.join("packages", target),
    ]
    seen, uniq = set(), []
    for c in out:
        c = os.path.normpath(c)
        if c != "." and not c.startswith("..") and c not in seen:
            seen.add(c)
            uniq.append(c)
    return uniq


def key_of(heading):
    return heading.rstrip("…").rstrip(".").strip().lower()


def resolve(root, referrer, target, heading, text_of):
    """First candidate that exists and contains the heading, else first that exists."""
    first_existing = None
    for c in candidates(referrer, target):
        text = text_of(c)
        if text is None:
            continue
        if first_existing is None:
            first_existing = c
        if key_of(heading) in text.lower():
            return c, True
    return first_existing, False


def main(argv):
    root = "."
    base = None
    as_json = False
    args = iter(argv)
    for a in args:
        if a == "--base":
            base = next(args, None)
        elif a == "--json":
            as_json = True
        else:
            root = a
    root = os.path.abspath(root)
    cache = {}

    def text_of(rel):
        if rel not in cache:
            cache[rel] = read(root, rel)
        return cache[rel]

    pointers = []
    for rel in list_files(root):
        if os.path.splitext(rel)[1] not in TEXT_EXT:
            continue
        if any(part in SKIP_DIRS for part in rel.split(os.sep)):
            continue
        text = text_of(rel)
        if not text:
            continue
        for m in POINTER.finditer(text):
            pointers.append((rel, m.group(1), m.group(2)))

    if base is None:
        by_target = defaultdict(list)
        for referrer, target, heading in pointers:
            resolved, ok = resolve(root, referrer, target, heading, text_of)
            if resolved is None:
                continue
            by_target[resolved].append({"heading": heading, "from": referrer, "present": ok})
        if as_json:
            print(json.dumps(by_target, indent=2, sort_keys=True))
        else:
            for target in sorted(by_target):
                print(target)
                for p in sorted(by_target[target], key=lambda x: x["heading"]):
                    mark = "" if p["present"] else "  [missing]"
                    print(f'  "{p["heading"]}"  <- {p["from"]}{mark}')
        return 0

    base_cache = {}

    def base_text_of(rel):
        if rel not in base_cache:
            base_cache[rel] = read_at(root, base, rel)
        return base_cache[rel]

    broken = []
    for referrer, target, heading in pointers:
        resolved, ok = resolve(root, referrer, target, heading, text_of)
        if ok or resolved is None:
            continue
        old = base_text_of(resolved)
        if old is not None and key_of(heading) in old.lower():
            broken.append({"from": referrer, "target": resolved, "heading": heading})
    if as_json:
        print(json.dumps(broken, indent=2))
    else:
        for b in broken:
            print(f'{b["from"]} -> {b["target"]} :: "{b["heading"]}"')
        print(f"broken: {len(broken)}")
    return 1 if broken else 0


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except BrokenPipeError:
        sys.exit(0)
