// jordanmansfield.dev Worker
//
// The public site is plain files in public/, served straight by Cloudflare.
// This script only answers /admin (the editor page) and /api/* (what the editor
// talks to). Saving in the editor commits content/site.json, plus any new
// images, to GitHub in one commit. The "Build site" GitHub Action then runs
// build.py and Cloudflare deploys the result, so GitHub stays the single home
// of the site.
//
// Needs two secrets on the Worker (Cloudflare → Settings → Variables and Secrets):
//   ADMIN_PASSWORD  the password for /admin
//   GITHUB_TOKEN    a fine-grained GitHub token for this repo only:
//                   Contents read and write, Actions read only

import ADMIN_HTML from "./admin.html";

const CONTENT_PATH = "content/site.json";
const UPLOAD_DIR = "public/assets/uploads/";
const COOKIE = "jm_admin";
const SESSION_DAYS = 30;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (path === "/admin" || path === "/admin/") return adminPage();
    if (path.startsWith("/api/")) {
      try {
        return await api(request, env, path.slice(5), url);
      } catch (err) {
        return json({ error: "server", message: String(err && err.message || err) }, 500);
      }
    }
    return env.ASSETS.fetch(request);
  },
};

function adminPage() {
  return new Response(ADMIN_HTML, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex, nofollow",
      "x-frame-options": "DENY",
      "referrer-policy": "no-referrer",
    },
  });
}

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra },
  });
}

// ---------------------------------------------------------------- api

async function api(request, env, route, url) {
  const missing = ["ADMIN_PASSWORD", "GITHUB_TOKEN"].filter((k) => !env[k]);
  if (missing.length) return json({ error: "setup", missing }, 503);

  if (request.method === "POST" && request.headers.get("x-admin") !== "1") {
    return json({ error: "forbidden" }, 403);
  }

  if (route === "login" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    if (!(await samePassword(String(body.password || ""), env.ADMIN_PASSWORD))) {
      await new Promise((r) => setTimeout(r, 900));
      return json({ error: "password" }, 401);
    }
    const expires = Date.now() + SESSION_DAYS * 864e5;
    const token = `${expires}.${await sign(String(expires), env)}`;
    return json({ ok: true }, 200, {
      "set-cookie": `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_DAYS * 86400}`,
    });
  }

  if (route === "logout" && request.method === "POST") {
    return json({ ok: true }, 200, { "set-cookie": `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0` });
  }

  if (!(await signedIn(request, env))) return json({ error: "auth" }, 401);

  const gh = github(env);

  if (route === "content" && request.method === "GET") {
    const head = await gh.head();
    const file = await gh.get(`/contents/${CONTENT_PATH}?ref=${head}`);
    const commit = await gh.get(`/commits/${head}`);
    return json({
      content: JSON.parse(fromBase64(file.content)),
      fileSha: file.sha,
      commit: head,
      updated: commit.commit && commit.commit.committer && commit.commit.committer.date,
      repo: gh.repo,
    });
  }

  if (route === "publish" && request.method === "POST") {
    const body = await request.json();
    const problem = checkContent(body.content);
    if (problem) return json({ error: "invalid", message: problem }, 400);
    const files = Array.isArray(body.files) ? body.files : [];
    for (const f of files) {
      if (typeof f.path !== "string" || !f.path.startsWith(UPLOAD_DIR) || !/^[a-z0-9][a-z0-9._-]*\.(jpg|jpeg|png|webp|gif|svg)$/.test(f.path.slice(UPLOAD_DIR.length))) {
        return json({ error: "invalid", message: `Not an allowed image path: ${f.path}` }, 400);
      }
      if (typeof f.data !== "string" || f.data.length > 20e6) return json({ error: "invalid", message: `Image too large: ${f.path}` }, 400);
    }
    const text = JSON.stringify(body.content, null, 2) + "\n";
    const message = (body.message && String(body.message).slice(0, 200)) || "Edit site content in /admin";

    for (let attempt = 0; attempt < 3; attempt++) {
      const head = await gh.head();
      const current = await gh.get(`/contents/${CONTENT_PATH}?ref=${head}`);
      if (current.sha !== body.fileSha) {
        return json({ error: "conflict", message: "The site content was changed somewhere else since you opened the editor." }, 409);
      }
      const base = await gh.get(`/git/commits/${head}`);
      const tree = [];
      const jsonBlob = await gh.post(`/git/blobs`, { content: text, encoding: "utf-8" });
      tree.push({ path: CONTENT_PATH, mode: "100644", type: "blob", sha: jsonBlob.sha });
      for (const f of files) {
        const blob = await gh.post(`/git/blobs`, { content: f.data, encoding: "base64" });
        tree.push({ path: f.path, mode: "100644", type: "blob", sha: blob.sha });
      }
      const newTree = await gh.post(`/git/trees`, { base_tree: base.tree.sha, tree });
      const commit = await gh.post(`/git/commits`, { message, tree: newTree.sha, parents: [head] });
      const moved = await gh.raw(`/git/refs/heads/${gh.branch}`, { method: "PATCH", body: JSON.stringify({ sha: commit.sha, force: false }) });
      if (moved.ok) {
        return json({ ok: true, commit: commit.sha, fileSha: jsonBlob.sha, updated: commit.committer && commit.committer.date });
      }
      if (moved.status !== 422 && moved.status !== 409) throw new Error(`GitHub refused the save (${moved.status})`);
      // Someone else pushed in the meantime (e.g. the build bot). Try again on top of it.
    }
    return json({ error: "busy", message: "GitHub was busy. Please press Save again." }, 503);
  }

  if (route === "status" && request.method === "GET") {
    const sha = url.searchParams.get("commit") || "";
    if (!/^[0-9a-f]{40}$/.test(sha)) return json({ error: "invalid" }, 400);
    const runs = await gh.get(`/actions/runs?head_sha=${sha}&per_page=10`);
    const run = (runs.workflow_runs || []).find((r) => r.name === "Build site");
    if (!run) return json({ status: "waiting" });
    return json({ status: run.status, conclusion: run.conclusion, url: run.html_url });
  }

  return json({ error: "not_found" }, 404);
}

function checkContent(c) {
  if (!c || typeof c !== "object" || !c.home || !Array.isArray(c.projects) || !c.footer || !c.not_found) {
    return "The content is missing a section.";
  }
  const seen = new Set();
  for (const p of c.projects) {
    if (!p || typeof p.slug !== "string" || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(p.slug)) {
      return `"${p && p.name || "A project"}" needs a web address made of lower-case letters, numbers and dashes.`;
    }
    if (p.slug === "index" || p.slug === "404" || p.slug === "admin") return `"${p.slug}" can't be used as a project's web address.`;
    if (seen.has(p.slug)) return `Two projects share the web address "${p.slug}".`;
    seen.add(p.slug);
    if (!p.name) return "Every project needs a name.";
  }
  if (!c.projects.some((p) => p.show !== false)) return "At least one project has to be shown on the site.";
  return "";
}

// ---------------------------------------------------------------- github

function github(env) {
  const repo = env.GITHUB_REPO || "jordanmansfield-lang/jordanmansfield-software";
  const branch = env.GITHUB_BRANCH || "main";
  const apiBase = (env.GITHUB_API || "https://api.github.com") + `/repos/${repo}`;
  const raw = (path, init = {}) =>
    fetch(apiBase + path, {
      ...init,
      headers: {
        authorization: `Bearer ${env.GITHUB_TOKEN}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "jordanmansfield-dev-admin",
        "content-type": "application/json",
        ...(init.headers || {}),
      },
    });
  const call = async (path, init) => {
    const res = await raw(path, init);
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      if (res.status === 401) throw new Error("GitHub didn't accept the token. It may have expired: make a new one and update GITHUB_TOKEN in Cloudflare.");
      if (res.status === 403 || res.status === 404) throw new Error(`GitHub said no (${res.status}). Check the token has access to ${repo} with Contents read and write.`);
      throw new Error(`GitHub error ${res.status}: ${detail.slice(0, 200)}`);
    }
    return res.json();
  };
  return {
    repo,
    branch,
    raw,
    get: (p) => call(p),
    post: (p, body) => call(p, { method: "POST", body: JSON.stringify(body) }),
    head: async () => (await call(`/git/ref/heads/${branch}`)).object.sha,
  };
}

function fromBase64(b64) {
  const bin = atob(String(b64 || "").replace(/\s/g, ""));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

// ---------------------------------------------------------------- sessions

async function hmacKey(env) {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(`jm-admin:${env.ADMIN_PASSWORD}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}

async function sign(value, env) {
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(env), new TextEncoder().encode(value));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function signedIn(request, env) {
  const cookie = request.headers.get("cookie") || "";
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE}=(\\d+)\\.([0-9a-f]{64})`));
  if (!m || Number(m[1]) < Date.now()) return false;
  return timingSafeEqual(m[2], await sign(m[1], env));
}

async function samePassword(given, real) {
  const digest = async (s) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  const [a, b] = await Promise.all([digest(given), digest(real)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
