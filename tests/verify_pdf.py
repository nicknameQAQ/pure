"""Read-only PDF content verification; requires pypdf in the QA environment."""
import json
import re
import sys
from pathlib import Path
from pypdf import PdfReader

sys.stdout.reconfigure(encoding="utf-8")
root = Path(sys.argv[1]) if len(sys.argv) > 1 else max(Path("test-results").glob("export-*"), key=lambda p: p.stat().st_mtime)
checks = [
    (root / "多页验收.pdf", ["屏幕外的起点", "完整导出的终点", "最后一行必须出现在PDF中。"]),
    (root / "错误图表验收.pdf", ["错误之后的内容仍然保留。", "flowchart???broken!"]),
]
summary = []
for path, terms in checks:
    reader = PdfReader(path)
    text = "\n".join(page.extract_text() or "" for page in reader.pages)
    compact = re.sub(r"\s+", "", text)
    for term in terms:
        assert term in compact, (path, term, text[-1000:])
    assert "YOURWORDS,YOURSPACE" not in compact
    summary.append({"file": str(path), "pages": len(reader.pages), "text_characters": len(text), "terms_verified": terms})
    path.with_suffix(".txt").write_text(text, encoding="utf-8")
assert summary[0]["pages"] >= 2
Path("test-results/pdf-qa.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps(summary, ensure_ascii=False))
