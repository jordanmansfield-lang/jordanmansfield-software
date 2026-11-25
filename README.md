# jordanmansfield.dev

Personal site, "Light Leak" identity, hosted as a Cloudflare Worker from this repo.

## Editing the site

Go to **jordanmansfield.dev/admin** and sign in. Everything on the pages can be changed there: the home page words, the
About and Contact sections, every project (text, facts, buttons, screenshot, install steps, roadmap), the footer and the
404 page. Projects can be added, reordered, hidden or deleted.

**Save & publish** saves the change to this repo as one commit. The *Build site* GitHub Action then rebuilds the pages
and Cloudflare deploys them, so it's live about a minute later. Every save is in the repo's history, so any change can be
undone.

## How it fits together

```
content/site.json       all the words, links and image paths (what /admin edits)
build.py                page templates + plugin release numbers; turns content/site.json into public/
public/                 the built site that Cloudflare serves
  assets/uploads/       screenshots uploaded through /admin
  downloads/            plugin installers and their update feeds (version.json)
worker/index.js         answers /admin and /api/*; everything else is served straight from public/
worker/admin.html       the admin page
.github/workflows/
  build-site.yml        runs build.py when content/ or build.py changes, commits public/
  tonal-bridge.yml      builds the Tonal Bridge Mac app
src/                    plugin sources (Tonal, Tonal Bridge)
wrangler.jsonc          Cloudflare Worker config
```

## One-time setup in Cloudflare

The Worker needs two secrets (Workers & Pages → `jordanmansfield-software` → Settings → Variables and Secrets, type **Secret**):

- `ADMIN_PASSWORD`: the password for /admin.
- `GITHUB_TOKEN`: a fine-grained GitHub token limited to this repo, with **Contents: Read and write** and **Actions: Read-only**.
  When it expires, make a new one and replace the secret.

## Plugin releases (Tonal, Dolly)

Drop the new `.ccx` into `public/downloads/<plugin>/`, update the `TONAL` / `DOLLY` block at the top of `build.py`, run
`python3 build.py`, commit and push. The page copy picks the new numbers up automatically through placeholders such as
`{tonal.version}` in `content/site.json`.

## Running it locally

`python3 build.py` (needs Pillow) rebuilds `public/`. `npx wrangler dev` runs the Worker; put `ADMIN_PASSWORD`,
`GITHUB_TOKEN` (and optionally `GITHUB_API`) in a `.dev.vars` file, which is git-ignored.

## The light leak

Two blurred shapes per section (`.leak__a` orange, `.leak__b` flare) that fade in on load, drift slowly and breathe with
the odd quick flare. Tune in `public/assets/site.css`: the `19s` / `13s` drift durations for speed, the opacity values in
`@keyframes flicker-a` / `flicker-b` for strength. People with "reduce motion" switched on get a still leak.
