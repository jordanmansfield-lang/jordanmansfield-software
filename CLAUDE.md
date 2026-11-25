# Notes for working on this repo

- Site copy, links and image paths live in `content/site.json`, which Jordan edits through /admin. Change words there,
  not in `build.py`. `build.py` only holds templates and the plugin release blocks (`TONAL`, `BRIDGE`, `DOLLY`).
- Copy refers to release numbers through placeholders (`{tonal.version}`, `{tonal.file}`, `{dolly.version}` and so on,
  listed in `TOKENS` in `build.py`). Add a new placeholder there when a new plugin ships.
- After changing `build.py` or `content/site.json`, run `python3 build.py` and commit `public/` too. The *Build site*
  Action also does this on push, so a forgotten rebuild still gets fixed.
- `content/site.json` is written by the admin as `JSON.stringify(content, null, 2)` plus a newline. Keep that format
  (UTF-8, two-space indent) so edits from both sides diff cleanly.
- Never commit `.dev.vars`. The Worker's secrets (`ADMIN_PASSWORD`, `GITHUB_TOKEN`) live in Cloudflare only.
