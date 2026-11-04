"""Generate the Atlas's source data from the repository itself.

Writes public/data/architecture.json (modules, functions and line ranges, and the import graph, read
with `ast`, so no dependency is ever hand-typed) and copies each Python module and the handwritten
AGENTS.md into public/data/source/. Vercel does not run Python, so the output is committed, as the rest
of public/data is. Run from site/: python scripts/build_atlas.py
"""
from __future__ import annotations

import ast
import json
import shutil
import sys
from pathlib import Path

SITE = Path(__file__).resolve().parents[1]
REPO = SITE.parent
PKG = REPO / "src" / "uplift"
OUT = SITE / "public" / "data"
STDLIB = set(sys.stdlib_module_names)


def describe(path: Path, internal: set[str]) -> dict:
    text = path.read_text(encoding="utf-8")
    tree = ast.parse(text)
    imports: set[str] = set()
    external: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for a in node.names:
                top = a.name.split(".")[0]
                if top == "uplift":
                    parts = a.name.split(".")
                    if len(parts) > 1:
                        imports.add(parts[1])
                elif top not in STDLIB:
                    external.add(top)
        elif isinstance(node, ast.ImportFrom):
            mod = node.module or ""
            if node.level > 0 or mod == "uplift" or mod.startswith("uplift."):
                base = mod.split(".")[-1] if mod and mod != "uplift" else ""
                if base and base in internal:
                    imports.add(base)
                else:
                    imports.update(a.name for a in node.names if a.name in internal)
            elif mod.split(".")[0] not in STDLIB:
                external.add(mod.split(".")[0])
    items = []
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            doc = ast.get_docstring(node) or ""
            items.append({
                "name": node.name,
                "kind": "class" if isinstance(node, ast.ClassDef) else "function",
                "line": node.lineno,
                "end": node.end_lineno,
                "doc": doc.strip().split("\n")[0][:160],
            })
    doc = (ast.get_docstring(tree) or "").strip().split("\n")[0][:200]
    return {
        "name": path.stem,
        "path": str(path.relative_to(REPO)).replace("\\", "/"),
        "lines": len(text.splitlines()),
        "doc": doc,
        "items": items,
        "imports": sorted(imports - {path.stem}),
        "external": sorted(external),
    }


def main() -> None:
    files = sorted(p for p in PKG.glob("*.py") if p.name != "__init__.py")
    hook = PKG / "arm_hooks" / "uplift_hook.py"
    internal = {p.stem for p in files}
    modules = [describe(p, internal) for p in files]
    src = OUT / "source"
    src.mkdir(parents=True, exist_ok=True)
    for p in [*files, hook]:
        shutil.copyfile(p, src / p.name)
    shutil.copyfile(REPO / "arms" / "handwritten" / "AGENTS.md", src / "handwritten-AGENTS.md")
    modules.append(describe(hook, internal))
    (OUT / "architecture.json").write_text(json.dumps({"modules": modules}, indent=1), encoding="utf-8")
    edges = sum(len(m["imports"]) for m in modules)
    print(f"{len(modules)} modules, {edges} import edges")


if __name__ == "__main__":
    main()
