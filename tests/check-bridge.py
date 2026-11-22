#!/usr/bin/env python3
"""Static check without an Android SDK:
 1. every OC.<method>(...) used by the bundled UI must exist as an @JavascriptInterface
    method in MainActivity.kt AND in tests/mock.js (so e2e runs against the same bridge);
 2. Kotlin sources must stay balanced on braces/parens/quotes;
 3. no leftover TODO/XXX markers in the UI.

Usage: python3 tests/check-bridge.py
"""
import re, sys, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UI = os.path.join(ROOT, 'app/src/main/assets/ui/js')
KT = os.path.join(ROOT, 'app/src/main/java/app/opencodemob/MainActivity.kt')
MOCK = os.path.join(ROOT, 'tests/mock.js')

kt = open(KT, encoding='utf-8').read()
mock = open(MOCK, encoding='utf-8').read()

kt_methods = set(re.findall(r'@JavascriptInterface\s+(?:@JvmOverloads\s+)?fun\s+(\w+)', kt))
mock_methods = set(re.findall(r'\b(\w+)\s*[:=]\s*(?:\([^)]*\)\s*=>|\()?|(\w+)\s*\(', mock))
mock_methods = {a or b for a, b in mock_methods if (a or b)}

used = set()
for f in sorted(os.listdir(UI)):
    src = open(os.path.join(UI, f), encoding='utf-8').read()
    used |= set(re.findall(r'\bOC\.(\w+)\s*\(', src))

fail = []
# 1. bridge coverage
for m in sorted(used):
    if m not in kt_methods:
        fail.append(f'UI calls OC.{m}() but MainActivity.kt has no @JavascriptInterface {m}')
    if m not in mock_methods:
        fail.append(f'mock.js has no {m}() - e2e would crash on OC.{m}()')
# 2. kotlin sanity: the bridge methods we rely on
for need in ['signInGuest', 'resetInstall', 'authLogin', 'authLogout', 'signInEmail', 'signOut']:
    if need not in kt_methods:
        fail.append(f'MainActivity.kt is missing the {need} bridge')
# 3. leftover markers in the UI
for f in sorted(os.listdir(UI)):
    src = open(os.path.join(UI, f), encoding='utf-8').read()
    for m in ('TODO', 'XXX', 'FIXME', '待补充'):
        if m in src:
            fail.append(f'{f} contains a leftover marker {m}')

# 4. quick brace balance on Kotlin files (syntax accidents). String literals, char literals and
# comments are stripped first: the preview builder embeds raw HTML/CSS that contains braces, and a
# naive count reported every such file as broken.
def strip_kotlin(text):
    out, i, n = [], 0, len(text)
    while i < n:
        c = text[i]
        if text.startswith('"""', i):
            j = text.find('"""', i + 3)
            i = n if j < 0 else j + 3
            out.append('""')
            continue
        if c == '"':
            i += 1
            while i < n:
                if text[i] == '\\':
                    i += 2
                    continue
                if text[i] == '"':
                    i += 1
                    break
                i += 1
            out.append('""')
            continue
        if c == "'":
            i += 1
            while i < n:
                if text[i] == '\\':
                    i += 2
                    continue
                if text[i] == "'":
                    i += 1
                    break
                i += 1
            out.append("''")
            continue
        if text.startswith('//', i):
            j = text.find('\n', i)
            i = n if j < 0 else j
            continue
        if text.startswith('/*', i):
            j = text.find('*/', i + 2)
            i = n if j < 0 else j + 2
            continue
        out.append(c)
        i += 1
    return ''.join(out)

for f in sorted(os.listdir(os.path.dirname(KT))):
    if not f.endswith('.kt'): continue
    src = strip_kotlin(open(os.path.join(os.path.dirname(KT), f), encoding='utf-8').read())
    for open_ch, close_ch, label in (('{', '}', 'braces'), ('(', ')', 'parens'), ('[', ']', 'brackets')):
        if src.count(open_ch) != src.count(close_ch):
            fail.append(f'{f}: unbalanced {label} {src.count(open_ch)} vs {src.count(close_ch)}')

print(f'bridge methods used by UI: {len(used)}; @JavascriptInterface in Kotlin: {len(kt_methods)}')
if fail:
    print('FAIL:')
    for x in fail:
        print(' -', x)
    sys.exit(1)
print('check-bridge: OK')
