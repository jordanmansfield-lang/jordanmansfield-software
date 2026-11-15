# jordanmansfield — personal site

Static site, "Light Leak" identity. No build step needed to deploy: everything served is in `public/`.

```
public/
  index.html            home: intro, work, about, contact
  framesync.html        project pages (one per project)
  picturedesk.html
  tenframe.html
  film-galleries.html
  myschoolphotograph.html
  404.html
  assets/site.css       all styles, including the animated light leak
  assets/grain.png      film grain tile
  assets/favicon.svg
build.py                regenerates the HTML from the project list (python3 build.py, needs Pillow)
wrangler.jsonc          Cloudflare Workers static-assets config
```

## Deploy (Cloudflare Workers, from GitHub)

1. Create a repo (this one: `jordanmansfield-lang/jordanmansfield-software`) and push this folder.
2. Cloudflare dashboard → Workers & Pages → Create → Import a repository → pick the repo.
   Build command: none. Deploy command: `npx wrangler deploy`.
3. It goes live on a `*.workers.dev` address. Add your own domain under the Worker's Settings → Domains & Routes when you're ready.

## Before going live

- Fill the placeholders: `[YOUR EMAIL]` and the about line `[A LINE ON WHY YOU BUILD SOFTWARE, IN YOUR WORDS]` (in `build.py`, then rerun it).
- Replace each `[SCREENSHOT]` box with an image: put it in `public/assets/` and swap the `<span>` inside `<figure class="shot">` for `<img src="assets/your-file.jpg" alt="…">`.
- Check the project copy and statuses in `build.py`.

## The light leak

Two blurred shapes per section (`.leak__a` orange, `.leak__b` flare) that fade in on load, drift slowly and breathe with the odd quick flare. Tune in `site.css`:

- speed: the `19s` / `13s` durations on the drift animations
- strength: the opacity values in `@keyframes flicker-a` / `flicker-b`
- people with "reduce motion" switched on get a still leak.
