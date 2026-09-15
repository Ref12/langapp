"""Static review panels from the exact original Korean pilot paths and samples."""

from html import escape
import math
import unicodedata

from character_geometry import sample_path


def _number(value: float) -> str:
    return f"{value:.3f}"


def glyph_svg(details: dict, index: int) -> str:
    paths, overlays, boxes = [], [], []
    stroke_index = 0
    for part_index, part in enumerate(details["parts"]):
        points = [point for path in part["paths"] for point in sample_path(path)]
        x, y = (min(point[axis] for point in points) for axis in (0, 1))
        width, height = (max(point[axis] for point in points) - start
                         for axis, start in ((0, x), (1, y)))
        boxes.append(
            f'<rect class="component-box" x="{_number(x)}" y="{_number(y)}" '
            f'width="{_number(width)}" height="{_number(height)}"/>'
        )
        for path in part["paths"]:
            stroke_index += 1
            samples = sample_path(path)
            paths.append(
                f'<path class="ink part-{part_index}" data-stroke="{stroke_index - 1}" '
                f'd="{escape(path, quote=True)}"/>'
                f'<path class="trace" pathLength="1" style="--order:{stroke_index - 1}" '
                f'd="{escape(path, quote=True)}"/>'
            )
            for px, py in samples:
                overlays.append(f'<circle class="sample" cx="{_number(px)}" cy="{_number(py)}" r=".65"/>')
            start = samples[0]
            middle = max(0, (len(samples) - 1) // 2)
            before, after = samples[middle], samples[min(middle + 1, len(samples) - 1)]
            angle = math.atan2(after[1] - before[1], after[0] - before[0])
            tip = [before[0] + 3 * math.cos(angle), before[1] + 3 * math.sin(angle)]
            overlays.append(
                f'<g class="annotation" data-stroke="{stroke_index - 1}">'
                f'<line class="direction" x1="{_number(before[0])}" y1="{_number(before[1])}" '
                f'x2="{_number(tip[0])}" y2="{_number(tip[1])}" marker-end="url(#arrow-{index})"/>'
                f'<circle class="start" cx="{_number(start[0])}" cy="{_number(start[1])}" r="1.4"/>'
                f'<text class="order" x="{_number(start[0] + 1.5)}" '
                f'y="{_number(max(5, start[1] - 3))}">{stroke_index}</text></g>'
            )
    return (
        f'<svg viewBox="0 0 100 100" role="img" aria-label="Original unreviewed stroke candidate">'
        f'<defs><marker id="arrow-{index}" markerWidth="4" markerHeight="4" refX="3" refY="2" '
        f'orient="auto" markerUnits="userSpaceOnUse"><polygon points="0,0 4,2 0,4" fill="#b8193b"/>'
        '</marker></defs><path class="grid" d="M0 50 L100 50 M50 0 L50 100"/>'
        + "".join(boxes) + "".join(paths) + "".join(overlays) + "</svg>"
    )


def render_preview(inventory: dict, records: dict, report: dict, manifest_hash: str) -> str:
    cards = []
    for index, (character, detail) in enumerate(report["characters"].items()):
        variant = records[character]["variants"][0]
        flags = detail["flags"]
        warning = (
            "<ul>" + "".join("<li>" + escape(str(flag)) + "</li>" for flag in flags) + "</ul>"
            if flags else "<p>No mechanical density hint; not a readability or stroke-order approval.</p>"
        )
        ordered_paths = "".join("<li><code>" + escape(stroke["path"]) + "</code></li>"
                                for stroke in variant["strokes"])
        cards.append(
            f'<article id="cp{ord(character):04x}" data-character="{escape(character, quote=True)}" '
            f'data-flagged="{str(bool(flags)).lower()}"><header><h2>{escape(character)} '
            f'<small>U+{ord(character):04X}</small></h2><span class="badge">UNREVIEWED</span></header>'
            f'<p>{escape(unicodedata.name(character))}'
            '</p>'
            + glyph_svg(detail, index)
            + f'<p>{detail["stroke_count"]} logical strokes; original AI-assisted; '
            + escape(records[character]["kind"]) + ".</p>"
            + f'<button type="button" class="replay">Replay {detail["stroke_count"]} strokes</button>'
            + '<button type="button" class="step">Next stroke</button>'
            + '<output class="step-status" aria-live="polite">All strokes</output>'
            + "<details><summary>Density / contact hints (" + str(len(flags)) + ")</summary>"
            + warning + "</details><details><summary>Exact final display and sampling paths</summary><ol>"
            + ordered_paths + "</ol></details></article>"
        )
    contexts = report["contextual_assignments"]
    absent_contexts = "".join("<li><code>" + escape(cell) + "</code></li>"
                             for cell in contexts["unexercised"])
    missing = sorted((set(inventory["required"]) | set(inventory["components"])) - records.keys())
    flagged = sum(bool(detail["flags"]) for detail in report["characters"].values())
    return (
        "<!doctype html>\n<html lang=\"en\"><head><meta charset=\"utf-8\">"
        "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">"
        "<title>Korean original writing pilot - unreviewed</title><style>"
        "body{font:15px system-ui,sans-serif;margin:0;color:#172033;background:#f4f6fa}"
        "main{max-width:1280px;margin:auto;padding:24px}h1,h2{line-height:1.2}"
        "a{color:#165c9c}.warning{background:#fff1d8;border-left:5px solid #a44900;padding:16px}"
        ".controls{position:sticky;top:0;z-index:2;padding:12px;background:#fff;border:1px solid #cbd1db}"
        ".controls label{margin-right:16px}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));"
        "gap:16px;margin-top:20px}article{background:#fff;border:1px solid #cbd1db;border-radius:8px;padding:12px}"
        "article header{display:flex;justify-content:space-between;align-items:center}h2{margin:0}h2 small{font-size:12px}"
        ".badge{background:#fff0ce;color:#783a00;padding:4px;font-size:10px}article p{font-size:12px}"
        "svg{display:block;width:100%;max-width:260px;aspect-ratio:1;margin:auto;border:1px solid #ddd}"
        ".ink,.trace{fill:none;stroke-width:5.5;stroke-linecap:round;stroke-linejoin:round}.ink{stroke:#243a50}"
        ".part-1{stroke:#18654a}.part-2{stroke:#6b3d89}.trace{stroke:#df4e12;visibility:hidden;stroke-dasharray:1;"
        "stroke-dashoffset:1}.playing .trace{visibility:visible;animation:draw .8s linear both;"
        "animation-delay:calc(var(--order)*.9s)}@keyframes draw{to{stroke-dashoffset:0}}"
        ".grid{stroke:#ddd;stroke-width:.4;fill:none}.sample{fill:#086fa8;display:none}.component-box{fill:none;"
        "stroke:#9d6311;stroke-width:.5;stroke-dasharray:2;display:none}.direction{stroke:#b8193b;stroke-width:.7}"
        ".order{fill:#b8193b;font:bold 5px system-ui;paint-order:stroke;stroke:#fff;stroke-width:1}"
        ".start{fill:#b8193b}.show-samples .sample,.show-boxes .component-box{display:block}"
        ".hide-directions .direction,.hide-directions .order,.hide-directions .start{display:none}"
        ".stepping .ink{opacity:.15}.stepping .ink.current{opacity:1}"
        ".stepping .annotation:not(.current){display:none}.step-status{display:block;font-size:12px;margin:6px 0}"
        ".overview .cards{grid-template-columns:repeat(auto-fit,minmax(135px,1fr));gap:10px}"
        ".overview article{padding:8px}.overview svg{max-width:130px}.overview h2{font-size:17px}"
        ".overview h2 small{display:block;font-size:10px}.overview .badge{font-size:7px;padding:2px}"
        ".overview article p,.overview article button,.overview article details,.overview article output,"
        ".overview .annotation,.overview .sample,.overview .component-box{display:none}"
        "button,input{font:inherit}button{padding:6px 10px}details{margin-top:8px}code{overflow-wrap:anywhere;"
        "font-size:11px}li{margin:4px 0}.hidden{display:none}</style></head><body class=\"hide-directions\"><main>"
        "<h1>Korean original monoline pilot</h1>"
        "<p class=\"warning\"><strong>Original AI-assisted candidates. No qualified Korean approval. "
        "No automatic release.</strong> These paths were authored for this pilot, not imported, traced "
        "from UnPen, extracted from annotation arrows, or sampled from an unlicensed model. "
        "Inspect stroke direction/order and dense forms before accepting any geometry.</p>"
        f"<p><strong>{len(records)} candidates:</strong> 118 modern foundation identities, 54 explicit "
        "curriculum syllables and two literal signs. All are unreviewed. "
        f"Of 1,276 Hangul keys, {len(missing)} remain unavailable outside the pilot. "
        "The two phonetic-display supplements retain separate inventory reasons, not spelling replacements.</p>"
        f"<p><strong>Context gate:</strong> {contexts['exercised']} of {contexts['total']} observed "
        "initial/vowel/final contextual assignments exercised; qualified reviewed: 0. "
        f"<strong>Density/contact-flagged candidates: {flagged}.</strong> "
        "Hints are conservative samples, not an exhaustive collision proof; intended contacts also need review. "
        "Fixed pen width is 5.5 in the same 100-unit frame for all parts.</p>"
        "<p>Replay, complete artwork and blue samples use the exact same final paths. "
        "Red numbers/arrows are annotations; dashed boxes show rendered component extents, not fitting targets.</p>"
        "<p><strong>Revision 2:</strong> vertical-tick ㅎ/ㅊ, connected ㅐ/ㅒ crossbars, corrected ㅌ order, "
        "joined ㅅ/ㅈ branches, full-height paired forms and revised mixed-vowel spacing. "
        "Use Next stroke to inspect pen lifts without overlapping labels. "
        "<a href=\"../upstream/writing/handwriting-review.yaml\">Reference comparison and remaining limits</a>.</p>"
        "<p><a href=\"coverage.yaml\">Authoritative coverage</a> | <a href=\"manifest.yaml\">Manifest</a> | "
        "<a href=\"pilot-review.yaml\">Machine-readable review report</a> | "
        "<a href=\"../licenses/ORIGINAL-WRITING-PILOT.md\">Original asset notice</a> | "
        "<a href=\"../upstream/writing/source-assessment.yaml\">Upstream source-gap assessment</a></p>"
        "<details><summary>Unexercised contextual assignments: scaling remains gated</summary><ul>"
        + absent_contexts + "</ul></details>"
        "<p>Manifest SHA-256: <code>" + manifest_hash + "</code></p>"
        "<div class=\"controls\"><label>Find scalar <input id=\"find\" size=\"5\" aria-label=\"Find scalar\"></label>"
        "<label><input type=\"checkbox\" id=\"samples\">Samples</label>"
        "<label><input type=\"checkbox\" id=\"boxes\">Component boxes</label>"
        "<label><input type=\"checkbox\" id=\"directions\">Order / direction</label>"
        "<label><input type=\"checkbox\" id=\"overview\">Overview</label>"
        "<label><input type=\"checkbox\" id=\"flagged\">Flagged only</label></div>"
        "<section class=\"cards\">" + "".join(cards) + "</section>"
        "<script>const body=document.body;for(const [id,name,invert] of "
        "[['samples','show-samples',false],['boxes','show-boxes',false],['directions','hide-directions',true],"
        "['overview','overview',false]]){"
        "document.getElementById(id).addEventListener('change',e=>body.classList.toggle(name,invert?!e.target.checked:e.target.checked));}"
        "function filter(){const text=document.getElementById('find').value.trim();"
        "const flagged=document.getElementById('flagged').checked;document.querySelectorAll('article').forEach("
        "a=>a.classList.toggle('hidden',(text&&!text.includes(a.dataset.character))||(flagged&&a.dataset.flagged!=='true')));}"
        "document.getElementById('find').addEventListener('input',filter);"
        "document.getElementById('flagged').addEventListener('change',filter);"
        "const selected=new URL(location.href).searchParams.get('characters');if(selected){"
        "document.getElementById('find').value=selected;filter();}"
        "if(new URL(location.href).searchParams.get('view')==='overview'){"
        "body.classList.add('overview');document.getElementById('overview').checked=true;}"
        "function showStep(a,index){const count=a.querySelectorAll('.ink').length;"
        "a.classList.remove('playing');a.classList.toggle('stepping',index<count);"
        "a.dataset.step=String(index);a.querySelectorAll('.ink,.annotation').forEach("
        "p=>p.classList.toggle('current',Number(p.dataset.stroke)===index));"
        "a.querySelector('output').textContent=index<count?'Stroke '+(index+1)+' / '+count:'All strokes';}"
        "document.querySelectorAll('.step').forEach(b=>b.addEventListener('click',()=>{"
        "const a=b.closest('article'),count=a.querySelectorAll('.ink').length;"
        "showStep(a,((a.dataset.step===undefined?count:Number(a.dataset.step))+1)%(count+1));}));"
        "document.querySelectorAll('.replay').forEach(b=>b.addEventListener('click',()=>{"
        "const a=b.closest('article');showStep(a,a.querySelectorAll('.ink').length);"
        "void a.offsetWidth;a.classList.add('playing');}));"
        "</script></main></body></html>\n"
    )
