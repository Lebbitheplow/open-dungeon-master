# Finds icons that came back with writing in them and marks them for a re-roll.
#
# Reads every raw icon render under data/icon-src with an OCR model (CPU only),
# and gives each one that contains letters a fresh seed salt in
# scripts/icon-review.json; the next plain run of generate-icons.mjs re-renders
# exactly those. Run it with the OCR environment's python:
#   ~/.cache/odm-art/ocr/bin/python scripts/scan-icon-text.py <round>
# The round number becomes part of the salt, so each pass rolls a new picture.
import glob, json, os, re, sys
from rapidocr_onnxruntime import RapidOCR

ROUND = sys.argv[1] if len(sys.argv) > 1 else "1"
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
ocr = RapidOCR()
hits = {}
files = [f for f in sorted(glob.glob(f"{ROOT}/data/icon-src/*/*.png")) if not f.endswith((".cut.png", ".mask.png")) and "contact-" not in f]
for f in files:
    try:
        result, _ = ocr(f)
    except Exception:
        continue
    words = [t for _, t, c in (result or []) if float(c) > 0.5 and len(re.sub(r"[^A-Za-z]", "", t)) >= 2]
    if words:
        hits[f"{os.path.basename(os.path.dirname(f))}-{os.path.basename(f)[:-4]}"] = " ".join(words)[:40]

path = f"{ROOT}/scripts/icon-review.json"
review = json.load(open(path)) if os.path.exists(path) else {"rejected": {}}
for key in hits:
    review["rejected"][key] = "t" + ROUND
json.dump(review, open(path, "w"), indent=2)
json.dump(hits, open(f"{ROOT}/data/icon-src/text-scan.json", "w"), indent=1)
print(f"flagged {len(hits)} of {len(files)}")
