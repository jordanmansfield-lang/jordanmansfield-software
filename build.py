"""Builds jordanmansfield.dev into ./public.

All the words, links and images live in content/site.json, which is what the
/admin page edits. This file only holds the page templates and the plugin
release numbers. A GitHub Action (.github/workflows/build-site.yml) runs it
whenever content/site.json or this file changes, so edits made in /admin go
live without anyone running it by hand. Running it locally is still fine:
python3 build.py (needs Pillow).
"""
import os, random, html, json, re
from PIL import Image

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, "public")
os.makedirs(OUT + "/assets", exist_ok=True)

# ---------- grain tile ----------
random.seed(7)
S = 240
img = Image.new("L", (S, S))
px = img.load()
for y in range(S):
    for x in range(S):
        px[x, y] = max(0, min(255, int(random.gauss(238, 24))))
img.save(OUT + "/assets/grain.png", optimize=True)

# ---------- Tonal releases ----------
# To ship a new version: drop Tonal-<version>.ccx into public/downloads/tonal/,
# update these lines, run `python3 build.py`, commit and push. Every installed
# copy of Tonal reads version.json and offers the update. The page copy picks the
# numbers up through {tonal.version} etc. in content/site.json.
TONAL = {
    "version": "1.3.1",
    "summary": "Fixes connecting to Tonal Bridge",  # one short line shown in the panel's update notice, e.g. "New HSL sliders"
    "min_premiere": "25.6",
}
TONAL_FILE = f"downloads/tonal/Tonal-{TONAL['version']}.ccx"
# Tonal Bridge: the small Mac app that connects MIDI controllers to Tonal.
# Built by .github/workflows/tonal-bridge.yml from src/tonal-bridge.
BRIDGE = {"version": "1.0.0"}
BRIDGE_FILE = f"downloads/tonal/TonalBridge-{BRIDGE['version']}.zip"

# ---------- Dolly releases ----------
# Same routine as Tonal: drop Dolly-<version>.ccx into public/downloads/dolly/,
# update these lines, run `python3 build.py`, commit and push.
DOLLY = {
    "version": "1.0.2",
    "summary": "Keeps your framing when you push a clip again",  # one short line shown in the panel's update notice
    "min_premiere": "25.6",
}
DOLLY_FILE = f"downloads/dolly/Dolly-{DOLLY['version']}.ccx"

# Placeholders the copy in content/site.json can use.
TOKENS = {
    "{tonal.version}": TONAL["version"], "{tonal.min_premiere}": TONAL["min_premiere"], "{tonal.file}": TONAL_FILE,
    "{bridge.version}": BRIDGE["version"], "{bridge.file}": BRIDGE_FILE,
    "{dolly.version}": DOLLY["version"], "{dolly.min_premiere}": DOLLY["min_premiere"], "{dolly.file}": DOLLY_FILE,
}


def fill(value):
    """Swap placeholders like {tonal.version} for the real numbers, all the way down."""
    if isinstance(value, str):
        for k, v in TOKENS.items():
            value = value.replace(k, v)
        return value
    if isinstance(value, list):
        return [fill(v) for v in value]
    if isinstance(value, dict):
        return {k: fill(v) for k, v in value.items()}
    return value


with open(os.path.join(ROOT, "content", "site.json"), encoding="utf-8") as f:
    SITE = fill(json.load(f))
HOME, FOOT, NF = SITE["home"], SITE["footer"], SITE["not_found"]
PROJECTS = [p for p in SITE["projects"] if p.get("show", True)]


def styled(text):
    """*word* becomes italic, a new line becomes a line break (used for the big display names)."""
    return re.sub(r"\*(.+?)\*", r"<em>\1</em>", text).replace("\n", "<br>")


FONTS = ('<link rel="preconnect" href="https://fonts.googleapis.com">\n'
         '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
         '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Instrument+Serif:ital@0;1&family=Inter:wght@400;500&display=swap">')


def head(title, desc):
    return f'''<!DOCTYPE html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{html.escape(title)}</title>
<meta name="description" content="{html.escape(desc)}">
<meta property="og:title" content="{html.escape(title)}">
<meta property="og:description" content="{html.escape(desc)}">
<meta name="theme-color" content="#f7f5f0">
<link rel="icon" href="assets/favicon.svg" type="image/svg+xml">
{FONTS}
<link rel="stylesheet" href="assets/site.css">
</head>
<body>
<a class="skip" href="#main">Skip to content</a>'''


def leak(variant):
    return f'''<div class="leak leak--{variant}" aria-hidden="true"><div class="leak__a"></div><div class="leak__b"></div></div>'''


def header(back=False):
    back_html = '<a class="back" href="index.html#work">← All work</a>' if back else ""
    return f'''<header class="site-header wrap">
<div class="site-header__left"><a class="wordmark" href="index.html">Jordan Mansfield</a>{back_html}</div>
<nav aria-label="Main"><a href="index.html#work">Work</a><a href="index.html#about">About</a><a href="index.html#contact">Contact</a></nav>
</header>'''


FOOTER = f'''<footer class="site-footer wrap"><span>{FOOT["left"]}</span><span>{FOOT["right"]}</span></footer>
</body>
</html>
'''


def work_rows():
    out = ""
    for i, p in enumerate(PROJECTS, 1):
        out += f'''<li><a class="row" href="{p["slug"]}.html">
<span class="mono muted row__n">{i:02d}</span>
<span class="row__name">{p["name"]}</span>
<span class="row__desc muted">{p["short"]}</span>
<span class="mono muted row__tag">{p["tag"]}</span>
<span class="row__arrow" aria-hidden="true">→</span>
</a></li>
'''
    return out


about = "".join(f'<p class="muted">{t}</p>\n' for t in HOME["about"])
contact_links = "".join(f'<li><a href="{l["url"]}">{l["label"]}</a></li>\n' for l in HOME["contact_links"])
index = head(HOME["title"], HOME["description"]) + f'''
{header()}
<main id="main">
<section class="hero">
{leak("hero")}
<div class="wrap hero__inner">
<p class="eyebrow mono">{HOME["eyebrow"]}</p>
<h1 class="display">{styled(HOME["display"])}</h1>
<p class="intro">{HOME["intro"]}</p>
</div>
</section>

<section id="work" class="wrap section">
<div class="section__head"><h2>{HOME["work_title"]}</h2><span class="mono muted">({len(PROJECTS):02d})</span></div>
<ol class="rows">
{work_rows()}</ol>
</section>

<section id="about" class="wrap section split">
<h2>{HOME["about_title"]}</h2>
<div class="split__body">
<p class="pull">{HOME["about_pull"]}</p>
{about}</div>
</section>

<section id="contact" class="contact">
{leak("contact")}
<div class="wrap contact__inner">
<p class="eyebrow mono">{HOME["contact_eyebrow"]}</p>
<a class="contact__big" href="{HOME["contact_big_url"]}">{HOME["contact_big_label"]} <em>→</em></a>
<ul class="contact__links">
{contact_links}</ul>
</div>
</section>
</main>
''' + FOOTER

with open(OUT + "/index.html", "w") as f:
    f.write(index)

# Remove pages for projects that were deleted, hidden or renamed in /admin.
keep = {"index.html", "404.html"} | {p["slug"] + ".html" for p in PROJECTS}
for name in os.listdir(OUT):
    if name.endswith(".html") and name not in keep:
        os.remove(os.path.join(OUT, name))


def rows_section(title, items):
    if not items:
        return ""
    lis = "".join(f'''<li class="road__row"><span class="mono muted row__n">{j:02d}</span><span class="road__name">{r["name"]}</span><span class="muted road__desc">{r["text"]}</span><span class="mono road__status">{r["status"]}</span></li>''' for j, r in enumerate(items, 1))
    return f'''<section class="wrap section">
<div class="section__head"><h2>{title}</h2><span class="mono muted">({len(items):02d})</span></div>
<ol class="rows">{lis}</ol>
</section>'''


for i, p in enumerate(PROJECTS):
    nxt = PROJECTS[(i + 1) % len(PROJECTS)]
    meta = "".join(f'<div class="meta__item"><dt class="mono muted">{m["label"]}</dt><dd>{m["value"]}</dd></div>' for m in p["meta"])
    body = "".join(f"<p>{b}</p>" for b in p["body"])
    link = ""
    for l in p["links"]:
        if l.get("download"):
            link += f'<p class="cta"><a href="{l["url"]}" download>{l["label"]} ↓</a></p>'
        else:
            link += f'<p class="cta"><a href="{l["url"]}">{l["label"]} ↗</a></p>'
    image = p.get("image") or {}
    if image.get("src"):
        shot = f'<figure class="shot"><img src="{image["src"]}" alt="{html.escape(image.get("alt", ""))}"></figure>'
    else:
        shot = '<figure class="shot"><span class="mono muted">[SCREENSHOT]</span></figure>'
    sections = "".join(rows_section(s["title"], s["rows"]) for s in p["sections"])
    page = head(f'{p["name"]} — Jordan Mansfield', p["lede"]) + f'''
{header(back=True)}
<main id="main">
<section class="hero hero--project">
{leak("project")}
<div class="wrap hero__inner">
<p class="eyebrow mono">{i+1:02d} — {p["kind"]}</p>
<h1 class="display display--project">{styled(p["display"])}</h1>
<p class="lede">{p["lede"]}</p>
<dl class="meta">{meta}</dl>
{link}
</div>
</section>

<section class="wrap section--tight">
{shot}
</section>

<section class="wrap section split">
<h2>{p.get("about_title") or "What it does"}</h2>
<div class="split__body muted">{body}</div>
</section>

{sections}

<section class="wrap section--tight">
<a class="next" href="{nxt["slug"]}.html"><span class="mono muted">Next — {PROJECTS.index(nxt)+1:02d}</span><span class="next__name">{nxt["name"]} <em>→</em></span></a>
</section>
</main>
''' + FOOTER
    with open(f'{OUT}/{p["slug"]}.html', "w") as f:
        f.write(page)

notfound = head("Not found — Jordan Mansfield", "Page not found.") + f'''
{header()}
<main id="main">
<section class="hero">
{leak("hero")}
<div class="wrap hero__inner">
<p class="eyebrow mono">{NF["eyebrow"]}</p>
<h1 class="display">{styled(NF["display"])}</h1>
<p class="intro"><a href="index.html">{NF["link_label"]}</a></p>
</div>
</section>
</main>
''' + FOOTER
with open(OUT + "/404.html", "w") as f:
    f.write(notfound)

with open(OUT + "/assets/favicon.svg", "w") as f:
    f.write('''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><radialGradient id="g" cx="0.3" cy="0.35" r="0.75"><stop offset="0" stop-color="#f2b25c"/><stop offset="0.55" stop-color="#e9772f"/><stop offset="1" stop-color="#e9772f" stop-opacity="0"/></radialGradient></defs><rect width="64" height="64" rx="14" fill="#f7f5f0"/><circle cx="26" cy="28" r="30" fill="url(#g)"/></svg>''')
# ---------- plugin update feeds (each plugin reads its own version.json) ----------
for slug, name, rel, rel_file in [("tonal", "Tonal", TONAL, TONAL_FILE), ("dolly", "Dolly", DOLLY, DOLLY_FILE)]:
    os.makedirs(f"{OUT}/downloads/{slug}", exist_ok=True)
    if not os.path.exists(f"{OUT}/{rel_file}"):
        print(f"WARNING: {rel_file} is missing from public/ (the download link will 404)")
    with open(f"{OUT}/downloads/{slug}/version.json", "w") as f:
        json.dump({
            "version": rel["version"],
            "summary": rel["summary"],
            "page": f"https://jordanmansfield.dev/{slug}.html",
            "download": "https://jordanmansfield.dev/" + rel_file,
        }, f, indent=2)

print("built", sorted(os.listdir(OUT)))
