"""Builds the static site for jordan mansfield into ./public"""
import os, random, html
from PIL import Image

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "public")
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
# copy of Tonal reads version.json and offers the update.
TONAL = {
    "version": "1.1.2",
    "summary": "One-step undo",  # one short line shown in the panel's update notice, e.g. "New HSL sliders"
    "min_premiere": "25.6",
}
TONAL_FILE = f"downloads/tonal/Tonal-{TONAL['version']}.ccx"

# ---------- Dolly releases ----------
# Same routine as Tonal: drop Dolly-<version>.ccx into public/downloads/dolly/,
# update these lines, run `python3 build.py`, commit and push.
DOLLY = {
    "version": "1.0.1",
    "summary": "Fixes slowed-down and sped-up clips",  # one short line shown in the panel's update notice
    "min_premiere": "25.6",
}
DOLLY_FILE = f"downloads/dolly/Dolly-{DOLLY['version']}.ccx"

PROJECTS = [
    {
        "slug": "framesync", "name": "FrameSync", "name_html": "Frame<em>Sync</em>",
        "kind": "macOS app", "short": "Verified SSD-to-archive sync for finished projects",
        "tag": "macOS",
        "lede": "A verified copy of every finished project, from working drive to archive.",
        "meta": [("Platform", "macOS"), ("Stack", "Tauri 2 · React · TypeScript · Rust · SQLite"), ("Status", "Drive Sync in daily use")],
        "body": [
            "FrameSync copies finished wedding projects from working SSDs to archive hard drives and checks every file arrived intact, replacing hours of copying and comparing by hand.",
            "The working drive is the source of truth. The archive should be an exact, verified copy, and FrameSync never moves or deletes files that only exist on the archive.",
        ],
        "road": [("Drive Sync", "Copy finished projects from working SSDs to archive HDDs, then verify every file.", "Built"),
                 ("Cloud backup", "Automatic, versioned backup of active editing projects to Cloudflare R2.", "Next"),
                 ("Background", "Quiet monitoring that launches at login.", "Planned")],
        "link": None,
    },
    {
        "slug": "picturedesk", "name": "PictureDesk", "name_html": "Picture<em>Desk</em>",
        "kind": "Web platform", "short": "The back office for a wedding photography business",
        "tag": "Web",
        "lede": "The business operating system for wedding photographers and videographers.",
        "meta": [("Platform", "Web"), ("Stack", "pnpm monorepo · Railway · Clerk"), ("Status", "Running my own business")],
        "shot": ("assets/picturedesk-projects.jpg", "PictureDesk’s Projects view: wedding cards with each couple’s delivery checklist and how many days each is past due"),
        "body": [
            "PictureDesk is the platform I always wished existed. Enquiries, projects, contacts, invoices and suppliers live in one place, built photographer-first rather than as a generic CRM.",
            "It runs my own bookings and is the single source of truth for the business.",
        ],
        "road": [("Contracts", "A template editor and contract editor, with signatures, expiry and reminders.", "Now"),
                 ("Quotes", "Proposals that turn into bookings.", "Next"),
                 ("Invoices", "Payments and history, all in one place.", "Next"),
                 ("Questionnaires", "Pre-wedding details, collected without the email back-and-forth.", "Planned")],
        "link": None,
    },
    {
        "slug": "tenframe", "name": "Tenframe", "name_html": "Ten<em>frame</em>",
        "kind": "Web app", "short": "Ten-slide Instagram carousels from a gallery",
        "tag": "Worker",
        "lede": "Drop in a gallery, get a ten-slide carousel.",
        "meta": [("Platform", "Web · desktop"), ("Stack", "Cloudflare Workers · R2"), ("Status", "Live")],
        "body": [
            "Tenframe turns an upload of 40 to 100 images into a ten-slide, 1080 × 1440 Instagram carousel. An image tray on the left, a slide strip in the middle and a live Instagram preview on the right.",
            "Each slide can take a preset layout, like bordered, landscape fit, stacked trio or staggered pair, and every carousel is saved so it can be revisited later.",
        ],
        "road": [("Carousel builder", "Upload, arrange, preview and export.", "Built"),
                 ("Accounts", "Sign in with Google and keep your own projects.", "Next"),
                 ("Open to photographers", "Tenframe for anyone who posts their work.", "Planned")],
        "link": ("Open Tenframe", "https://tenframe.jordan-mansfield.workers.dev"),
    },
    {
        "slug": "tonal", "name": "Tonal", "name_html": "To<em>nal</em>",
        "kind": "Premiere Pro plugin", "short": "Proper sliders for Premiere’s classic Lumetri Color",
        "tag": "Premiere",
        "lede": "Proper sliders for Premiere Pro’s classic Lumetri Color.",
        "meta": [("Works with", f"Premiere Pro {TONAL['min_premiere']} or later"), ("Version", TONAL["version"]), ("Tested on", "macOS")],
        "body": [
            "The latest Premiere Pro moves colour grading into a new Color tab. The classic Lumetri Color effect is still there to drag onto a clip, but its only controls are rows of raw numbers.",
            "Tonal is a docked panel that puts sliders back on it: white balance, light, creative and vignette. It edits the Lumetri Color effect already on your clips, so Premiere’s own engine still does the grading. Select several clips and one move changes them all. Keyframed settings are left alone.",
        ],
        "shot": ("assets/tonal-panel.jpg", "The Tonal panel: sliders for temperature, tint, saturation, exposure, contrast, highlights and shadows"),
        "steps_title": "Install",
        "steps": [("Download", "Get the .ccx file using the button above.", ""),
                  ("Install", "Quit Premiere, then double-click the file. Creative Cloud asks you to confirm. It warns you to only install plugins from sources you trust.", ""),
                  ("Open", "In Premiere, choose Window → UXP Plugins → Tonal, then dock the panel wherever suits you.", ""),
                  ("Update", "When a new version is out, a notice appears in the panel. Download it and double-click the new file to replace the old one.", "")],
        "road": [],
        "link": (f"Download Tonal {TONAL['version']}", TONAL_FILE),
        "download": True,
    },
    {
        "slug": "dolly", "name": "Dolly", "name_html": "Dol<em>ly</em>",
        "kind": "Premiere Pro plugin", "short": "Slow push-ins on every clip, at one steady speed",
        "tag": "Premiere",
        "lede": "Slow push-ins for Premiere Pro, on every clip at once.",
        "meta": [("Works with", f"Premiere Pro {DOLLY['min_premiere']} or later"), ("Version", DOLLY["version"])],
        "body": [
            "A subtle push-in means two Scale keyframes on every clip, set by hand hundreds of times a film. Presets help, but they reset a cropped clip’s Scale, and their keyframes drift off the clip as soon as you trim or slip it.",
            "Dolly is a docked panel. Pick a speed, select your clips and click once. Every clip zooms from its own starting Scale at the same pace, with keyframes on its first and last frames. After an edit, Refit all puts every zoom back on its clip’s ends, keeping each clip’s speed.",
        ],
        "shot": ("assets/dolly-panel.jpg", "The Dolly panel: In and Out, a speed slider set to 0.5% a second, and a Push in button for 24 selected clips"),
        "steps_title": "Install",
        "steps": [("Download", "Get the .ccx file using the button above.", ""),
                  ("Install", "Quit Premiere, then double-click the file. Creative Cloud asks you to confirm. It warns you to only install plugins from sources you trust.", ""),
                  ("Open", "In Premiere, choose Window → UXP Plugins → Dolly, then dock the panel wherever suits you.", ""),
                  ("Update", "When a new version is out, a notice appears in the panel. Download it and double-click the new file to replace the old one.", "")],
        "road": [],
        "link": (f"Download Dolly {DOLLY['version']}", DOLLY_FILE),
        "download": True,
    },
]

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


FOOTER = '''<footer class="site-footer wrap"><span>© 2026 Jordan Mansfield</span><span>Horsham, West Sussex</span></footer>
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


index = head("Jordan Mansfield", "Wedding photographer in Horsham, West Sussex, building the software his work runs on.") + f'''
{header()}
<main id="main">
<section class="hero">
{leak("hero")}
<div class="wrap hero__inner">
<p class="eyebrow mono">Small software, happy accidents</p>
<h1 class="display">Jordan<br><em>Mansfield</em></h1>
<p class="intro">Wedding photographer in Horsham, West Sussex. Between shoots I build the software my work runs on: backup tools, editing plugins, and the back office behind it all.</p>
</div>
</section>

<section id="work" class="wrap section">
<div class="section__head"><h2>Work</h2><span class="mono muted">({len(PROJECTS):02d})</span></div>
<ol class="rows">
{work_rows()}</ol>
</section>

<section id="about" class="wrap section split">
<h2>About</h2>
<div class="split__body">
<p class="pull">I grew up around my dad’s darkroom and started photographing weddings with him as a teenager.</p>
<p class="muted">I studied Fashion Photography at London College of Fashion, then spent years as a sport and commercial photographer at Getty Images. I’ve photographed weddings full-time since 2021, and school portraits under MySchoolPhotograph.</p>
<p class="muted">[A LINE ON WHY YOU BUILD SOFTWARE, IN YOUR WORDS]</p>
</div>
</section>

<section id="contact" class="contact">
{leak("contact")}
<div class="wrap contact__inner">
<p class="eyebrow mono">Contact</p>
<a class="contact__big" href="mailto:[YOUR EMAIL]">Say hello <em>→</em></a>
<ul class="contact__links">
<li><a href="mailto:[YOUR EMAIL]">[YOUR EMAIL]</a></li>
<li><a href="https://github.com/jordanmansfield-lang">GitHub ↗</a></li>
<li><a href="https://jordanmansfieldweddings.com">Weddings ↗</a></li>
<li><a href="https://www.myschoolphotograph.co.uk">School photography ↗</a></li>
</ul>
</div>
</section>
</main>
''' + FOOTER

with open(OUT + "/index.html", "w") as f:
    f.write(index)

for i, p in enumerate(PROJECTS):
    nxt = PROJECTS[(i + 1) % len(PROJECTS)]
    meta = "".join(f'<div class="meta__item"><dt class="mono muted">{k}</dt><dd>{v}</dd></div>' for k, v in p["meta"])
    body = "".join(f"<p>{b}</p>" for b in p["body"])
    if p["link"] and p.get("download"):
        link = f'<p class="cta"><a href="{p["link"][1]}" download>{p["link"][0]} ↓</a></p>'
    elif p["link"]:
        link = f'<p class="cta"><a href="{p["link"][1]}">{p["link"][0]} ↗</a></p>'
    else:
        link = ""
    if p.get("shot"):
        shot = f'<figure class="shot"><img src="{p["shot"][0]}" alt="{html.escape(p["shot"][1])}"></figure>'
    else:
        shot = '<figure class="shot"><span class="mono muted">[SCREENSHOT]</span></figure>'
    def rows_section(title, items):
        if not items:
            return ""
        lis = "".join(f'''<li class="road__row"><span class="mono muted row__n">{j:02d}</span><span class="road__name">{a}</span><span class="muted road__desc">{b}</span><span class="mono road__status">{st}</span></li>''' for j, (a, b, st) in enumerate(items, 1))
        return f'''<section class="wrap section">
<div class="section__head"><h2>{title}</h2><span class="mono muted">({len(items):02d})</span></div>
<ol class="rows">{lis}</ol>
</section>'''
    sections = rows_section(p.get("steps_title", ""), p.get("steps", [])) + rows_section("Roadmap", p["road"])
    page = head(f'{p["name"]} — Jordan Mansfield', p["lede"]) + f'''
{header(back=True)}
<main id="main">
<section class="hero hero--project">
{leak("project")}
<div class="wrap hero__inner">
<p class="eyebrow mono">{i+1:02d} — {p["kind"]}</p>
<h1 class="display display--project">{p["name_html"]}</h1>
<p class="lede">{p["lede"]}</p>
<dl class="meta">{meta}</dl>
{link}
</div>
</section>

<section class="wrap section--tight">
{shot}
</section>

<section class="wrap section split">
<h2>What it does</h2>
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
<p class="eyebrow mono">404 — Overexposed</p>
<h1 class="display">Nothing<br><em>here</em></h1>
<p class="intro"><a href="index.html">Back to the work →</a></p>
</div>
</section>
</main>
''' + FOOTER
with open(OUT + "/404.html", "w") as f:
    f.write(notfound)

with open(OUT + "/assets/favicon.svg", "w") as f:
    f.write('''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><radialGradient id="g" cx="0.3" cy="0.35" r="0.75"><stop offset="0" stop-color="#f2b25c"/><stop offset="0.55" stop-color="#e9772f"/><stop offset="1" stop-color="#e9772f" stop-opacity="0"/></radialGradient></defs><rect width="64" height="64" rx="14" fill="#f7f5f0"/><circle cx="26" cy="28" r="30" fill="url(#g)"/></svg>''')
# ---------- plugin update feeds (each plugin reads its own version.json) ----------
import json
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
