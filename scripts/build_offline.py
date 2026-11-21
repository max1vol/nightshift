"""Build the self-contained Nightshift presentation from the static app."""


from pathlib import Path
from base64 import b64encode
import json
import re


root = Path(__file__).resolve().parents[1]
dist = root / 'dist'
def code(name):
    return (dist / name).read_text()
def inline(name, mime):
    return f"data:{mime};base64," + b64encode((dist / name).read_bytes()).decode()
def remove_exports(source):
    return re.sub(r'^export ', '', source, flags=re.M)


compute = remove_exports(code('compute.mjs'))
stage = remove_exports(code('stage.mjs'))
worker = re.sub(r'^import .*?;\n', '', code('search-worker.mjs'), flags=re.M)
worker_input = compute.replace('import.meta.url', 'null') + '\n' + worker
worker_expr = "URL.createObjectURL(new Blob([" + json.dumps(worker_input) + "], {type:'text/javascript'}))"
compute = compute.replace("new URL('./search-worker.mjs', import.meta.url), { type: 'module' }", worker_expr)
app = re.sub(r'^import .*?;\n', '', code('nightshift.mjs'), flags=re.M)
app = app.replace('./impact.webp', inline('impact.webp', 'image/webp'))
html = code('index.html')
html = html.replace('<link rel="stylesheet" href="nightshift.css">', '<style>\n' + code('nightshift.css') + '\n</style>')
html = html.replace('href="mark.svg"', 'href="' + inline('mark.svg', 'image/svg+xml') + '"')
script = compute + '\n' + stage + '\n' + app
assert '</script' not in script.lower()
html = html.replace('<script type="module" src="nightshift.mjs"></script>', '<script type="module">\n' + script + '\n</script>')
(root / 'Nightshift-offline.html').write_text(html)
