#!/usr/bin/env bash
# End-to-end test of the bundled UI in headless Chromium against a fake opencode server.
# Needs: python3 + playwright (pip install playwright && playwright install chromium). No network at run time.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export UITEST_DIR="$(mktemp -d)"; export SHOTS="${SHOTS:-$UITEST_DIR}"
cp -r "$ROOT/app/src/main/assets/ui/." "$UITEST_DIR/"
cd "$UITEST_DIR"; mkdir -p vendor icons/files
echo 'window.DOMPurify={sanitize:s=>s};' > vendor/purify.js
cat > vendor/marked.js <<'JS'
(function(){const e=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
window.marked={parse:t=>{let o=e(t);o=o.replace(/```(\w*)\n([\s\S]*?)```/g,(m,l,c)=>'<pre><code class="language-'+l+'">'+c+'</code></pre>');o=o.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>');return '<p>'+o+'</p>'}}})();
JS
echo "window.hljs={getLanguage:()=>false,highlightElement(){},highlight:(t)=>({value:String(t)})};" > vendor/hljs.js
echo "window.Terminal=class{constructor(){this.cols=80;this.rows=24}open(){}loadAddon(){}onData(f){}onResize(){}write(d){window.__termOut=(window.__termOut||'')+(typeof d==='string'?d:'')}reset(){}focus(){}};" > vendor/xterm.js
echo "window.FitAddon={FitAddon:class{fit(){}}};" > vendor/addon-fit.js
: > vendor/xterm.css; echo '["python","folder","document","markdown"]' > icons/files/index.json
python3 "$ROOT/tests/e2e.py"
