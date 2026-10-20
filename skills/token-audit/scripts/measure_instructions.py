#!/usr/bin/env python3
"""Measure the agent instruction corpus Claude Code loads from a repository.

Usage: python3 measure_instructions.py [repo_root] [--json]

Reports, in bytes and approximate tokens (bytes / 4):
- always loaded: root CLAUDE.md, CLAUDE.local.md, .claude/rules/*.md without `paths`,
  @-imports inlined by those files, and skill descriptions (frontmatter only);
- per directory: the path-scoped rules and nested CLAUDE.md files a session pays
  once it reads a file there;
- the largest single files, so the report names where to cut.
Stdlib only; reads `git ls-files` when available, otherwise walks the tree.
"""
import json
import os
import re
import subprocess
import sys
from collections import defaultdict

SKIP_DIRS = {".git", "node_modules", "dist", "build", ".turbo", ".next", "coverage"}


def tokens(n):
    return round(n / 4)


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
        for f in filenames:
            files.append(os.path.relpath(os.path.join(dirpath, f), root))
    return files


def frontmatter(text):
    if not text.startswith("---"):
        return {}, text
    end = text.find("\n---", 3)
    if end == -1:
        return {}, text
    raw = text[3:end]
    meta = {}
    key = None
    for line in raw.splitlines():
        m = re.match(r"^([A-Za-z_-]+):\s*(.*)$", line)
        if m:
            key, val = m.group(1), m.group(2).strip()
            if val.startswith("[") and val.endswith("]"):
                meta[key] = [v.strip().strip("'\"") for v in val[1:-1].split(",") if v.strip()]
            elif val:
                meta[key] = val.strip("'\"")
            else:
                meta[key] = []
        elif key and re.match(r"^\s*-\s+", line):
            if not isinstance(meta.get(key), list):
                meta[key] = []
            meta[key].append(re.sub(r"^\s*-\s+", "", line).strip().strip("'\""))
        elif key and isinstance(meta.get(key), str) and line.startswith(" "):
            meta[key] += " " + line.strip()
    return meta, text[end + 4 :]


def expand_braces(glob):
    m = re.search(r"\{([^{}]*)\}", glob)
    if not m:
        return [glob]
    out = []
    for part in m.group(1).split(","):
        out.extend(expand_braces(glob[: m.start()] + part + glob[m.end() :]))
    return out


def glob_to_regex(glob):
    i, out = 0, ""
    while i < len(glob):
        c = glob[i]
        if glob.startswith("**/", i):
            out += "(?:.*/)?"
            i += 3
        elif glob.startswith("**", i):
            out += ".*"
            i += 2
        elif c == "*":
            out += "[^/]*"
            i += 1
        elif c == "?":
            out += "[^/]"
            i += 1
        else:
            out += re.escape(c)
            i += 1
    return re.compile("^" + out + "$")


def imports(text):
    return re.findall(r"(?m)^@(\S+)", text)


def area(path):
    parts = path.split("/")
    if len(parts) >= 3 and parts[0] in {"packages", "apps", "libs", "services", "modules"}:
        return "/".join(parts[:2])
    return parts[0] if len(parts) > 1 else "."


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    root = os.path.abspath(args[0] if args else ".")
    files = list_files(root)

    def size(rel):
        try:
            return os.path.getsize(os.path.join(root, rel))
        except OSError:
            return 0

    always, scoped, nested, skills = [], [], [], []

    for name in ("CLAUDE.md", "CLAUDE.local.md"):
        if os.path.exists(os.path.join(root, name)):
            always.append((name, size(name), "root"))
            text = open(os.path.join(root, name), encoding="utf-8", errors="ignore").read()
            for imp in imports(text):
                p = os.path.normpath(os.path.join(os.path.dirname(name), imp))
                if os.path.isfile(os.path.join(root, p)):
                    always.append((p, size(p), f"@-import from {name}"))

    rules_dir = os.path.join(root, ".claude", "rules")
    for dirpath, _, filenames in os.walk(rules_dir):
        for f in sorted(filenames):
            if not f.endswith(".md"):
                continue
            rel = os.path.relpath(os.path.join(dirpath, f), root)
            text = open(os.path.join(root, rel), encoding="utf-8", errors="ignore").read()
            meta, _ = frontmatter(text)
            globs = meta.get("paths") or []
            if isinstance(globs, str):
                globs = [globs]
            if globs:
                regs = [glob_to_regex(g) for gl in globs for g in expand_braces(gl)]
                scoped.append((rel, size(rel), regs, globs))
            else:
                always.append((rel, size(rel), "rule without paths"))

    for f in files:
        if os.path.basename(f) == "CLAUDE.md" and "/" in f:
            nested.append((f, size(f)))

    seen = set()
    for base in (".claude/skills", ".agents/skills"):
        d = os.path.join(root, base)
        if not os.path.isdir(d):
            continue
        for name in sorted(os.listdir(d)):
            sk = os.path.join(d, name, "SKILL.md")
            real = os.path.realpath(sk)
            if not os.path.isfile(sk) or real in seen:
                continue
            seen.add(real)
            meta, _ = frontmatter(open(sk, encoding="utf-8", errors="ignore").read())
            desc = meta.get("description", "")
            skills.append((name, len(desc.encode()), os.path.getsize(sk)))

    per_area = defaultdict(lambda: {"rules": {}, "claude_md": {}})
    for f in files:
        a = area(f)
        for rel, sz, regs, _ in scoped:
            if rel not in per_area[a]["rules"] and any(r.match(f) for r in regs):
                per_area[a]["rules"][rel] = sz
    areas = {area(f) for f in files}
    for rel, sz in nested:
        d = os.path.dirname(rel)
        for a in areas:
            if a == d or a.startswith(d + "/"):
                per_area[a]["claude_md"][rel] = sz

    always_bytes = sum(s for _, s, _ in always) + sum(d for _, d, _ in skills)
    report = {
        "root": root,
        "always_loaded": {
            "bytes": always_bytes,
            "tokens": tokens(always_bytes),
            "files": [{"path": p, "bytes": s, "why": w} for p, s, w in sorted(always, key=lambda x: -x[1])],
            "skill_descriptions": [{"skill": n, "description_bytes": d, "body_bytes": b} for n, d, b in sorted(skills, key=lambda x: -x[1])],
        },
        "per_area": sorted(
            (
                {
                    "area": a,
                    "bytes": sum(v["rules"].values()) + sum(v["claude_md"].values()),
                    "rules": sorted(v["rules"].items(), key=lambda x: -x[1]),
                    "claude_md": sorted(v["claude_md"].items(), key=lambda x: -x[1]),
                }
                for a, v in per_area.items()
                if v["rules"] or v["claude_md"]
            ),
            key=lambda x: -x["bytes"],
        ),
        "scoped_rules_matching_nothing": [rel for rel, _, regs, _ in scoped if not any(r.match(f) for r in regs for f in files)],
    }

    if "--json" in sys.argv:
        print(json.dumps(report, indent=1))
        return

    print(f"# Instruction corpus — {root}\n")
    print(f"Always loaded: {always_bytes:,} B ≈ {tokens(always_bytes):,} tokens\n")
    for f in report["always_loaded"]["files"]:
        print(f"  {f['bytes']:>7,}  {f['path']}  ({f['why']})")
    if skills:
        total = sum(d for _, d, _ in skills)
        print(f"\n  skill descriptions: {total:,} B over {len(skills)} skills (bodies load only on use)")
        for n, d, b in sorted(skills, key=lambda x: -x[1])[:8]:
            print(f"  {d:>7,}  {n}  (body {b:,} B)")
    print("\nPaid on top, once a session reads a file in the area (top 12):\n")
    for a in report["per_area"][:12]:
        print(f"  {a['bytes']:>7,} B ≈ {tokens(a['bytes']):>6,} tok  {a['area']}  ({len(a['rules'])} rules, {len(a['claude_md'])} CLAUDE.md)")
    big = sorted([(s, rel) for rel, s, _, _ in scoped] + [(s, rel) for rel, s in nested], reverse=True)[:10]
    print("\nLargest scoped files:\n")
    for s, rel in big:
        print(f"  {s:>7,}  {rel}")
    if report["scoped_rules_matching_nothing"]:
        print("\nScoped rules whose globs match no tracked file (never load):")
        for rel in report["scoped_rules_matching_nothing"]:
            print(f"  {rel}")


if __name__ == "__main__":
    main()
