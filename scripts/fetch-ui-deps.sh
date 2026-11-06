#!/usr/bin/env bash
# Vendors everything the bundled UI needs, so the app works with no network:
#   markdown, sanitizer, syntax highlighting, terminal emulator (npm, pinned versions)
#   file-type icons (SVG) taken from the upstream opencode repo at the same 1.x tag as the core
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
UI="$ROOT/app/src/main/assets/ui"
V="$UI/vendor"; IC="$UI/icons/files"
mkdir -p "$V" "$IC"
W="$(mktemp -d)"; cd "$W"

echo "== npm libraries =="
npm pack --silent marked@15.0.12 dompurify@3.2.6 @highlightjs/cdn-assets@11.11.1 @xterm/xterm@5.5.0 @xterm/addon-fit@0.10.0 >/dev/null
for f in *.tgz; do mkdir -p "x/${f%.tgz}"; tar -xzf "$f" -C "x/${f%.tgz}"; done
need() { [ -f "$1" ] || { echo "missing $1"; ls x; exit 1; }; cp "$1" "$2"; }
need x/marked-*/package/lib/marked.umd.js "$V/marked.js"
need x/dompurify-*/package/dist/purify.min.js "$V/purify.js"
need x/highlightjs-cdn-assets-*/package/highlight.min.js "$V/hljs.js"
need x/xterm-xterm-*/package/lib/xterm.js "$V/xterm.js"
need x/xterm-xterm-*/package/css/xterm.css "$V/xterm.css"
need x/xterm-addon-fit-*/package/lib/addon-fit.js "$V/addon-fit.js"

echo "== file icons from opencode =="
TAG="$(grep '^opencode_core=' "$ROOT/runtime-info.txt" | cut -d= -f2)"
AUTH=(); [ -n "${GH_TOKEN:-}" ] && AUTH=(-H "Authorization: Bearer $GH_TOKEN")
if curl -fsSL "${AUTH[@]}" "https://api.github.com/repos/anomalyco/opencode/contents/packages/ui/src/assets/icons/file-types?ref=$TAG" -o list.json; then
  python3 - <<'PY' > urls.txt
import json
for e in json.load(open("list.json")):
    if e.get("name", "").endswith(".svg") and e.get("download_url"):
        print(e["download_url"])
PY
  (cd "$IC" && xargs -P 16 -n 1 curl -fsSLO < "$W/urls.txt") || echo "warning: some icons failed to download"
else
  echo "warning: could not list icons at $TAG, the app will use generic file icons"
fi
python3 - "$IC" <<'PY' > "$IC/index.json"
import json, os, sys
print(json.dumps(sorted(f[:-4] for f in os.listdir(sys.argv[1]) if f.endswith(".svg"))))
PY
echo "icons: $(ls "$IC"/*.svg 2>/dev/null | wc -l)"
