/*
 * Tonal — friendly sliders for Premiere Pro's Lumetri Color effect.
 *
 * Reads and writes the parameters of the existing Lumetri Color effect
 * (match name "AE.ADBE Lumetri") on the selected timeline clips, using
 * Premiere's UXP API. Nothing here re-implements the grade — Premiere's own
 * Lumetri engine does the rendering, exactly as if you'd typed the numbers.
 */

const ppro = require("premierepro");

const LUMETRI = "AE.ADBE Lumetri";

// Group headers that appear inside Lumetri's parameter list. Used (when present)
// to tell apart parameters that share a name, e.g. the Saturation in Basic vs Creative.
const SECTION_NAMES = [
  "Basic Correction", "Creative", "Curves", "Color Wheels & Match",
  "Color Wheels", "HSL Secondary", "Vignette"
];

/*
 * Every slider. `section` + `name` locate the parameter; `nth` is the fallback
 * (which occurrence of that display name, counting from 0) if Premiere doesn't
 * expose section headers.
 */
const CONTROLS = [
  { group: "Basic", sub: "White balance", id: "temp", name: "Temperature", section: "Basic Correction", nth: 0, min: -100, max: 100, def: 0, dp: 1, track: "temp" },
  { group: "Basic", sub: "White balance", id: "tint", name: "Tint", section: "Basic Correction", nth: 0, min: -100, max: 100, def: 0, dp: 1, track: "tint" },
  { group: "Basic", sub: "White balance", id: "sat", name: "Saturation", section: "Basic Correction", nth: 0, min: 0, max: 200, def: 100, dp: 1, track: "sat" },

  { group: "Basic", sub: "Light", id: "exposure", name: "Exposure", section: "Basic Correction", nth: 0, min: -5, max: 5, def: 0, dp: 2, track: "exp" },
  { group: "Basic", sub: "Light", id: "contrast", name: "Contrast", section: "Basic Correction", nth: 0, min: -100, max: 100, def: 0, dp: 1 },
  { group: "Basic", sub: "Light", id: "highlights", name: "Highlights", section: "Basic Correction", nth: 0, min: -100, max: 100, def: 0, dp: 1, track: "gain" },
  { group: "Basic", sub: "Light", id: "shadows", name: "Shadows", section: "Basic Correction", nth: 0, min: -100, max: 100, def: 0, dp: 1, track: "lift" },
  { group: "Basic", sub: "Light", id: "whites", name: "Whites", section: "Basic Correction", nth: 0, min: -100, max: 100, def: 0, dp: 1, track: "gain" },
  { group: "Basic", sub: "Light", id: "blacks", name: "Blacks", section: "Basic Correction", nth: 0, min: -100, max: 100, def: 0, dp: 1, track: "lift" },

  { group: "Creative", id: "faded", name: "Faded Film", section: "Creative", nth: 0, min: 0, max: 100, def: 0, dp: 1 },
  { group: "Creative", id: "sharpen", name: "Sharpen", section: "Creative", nth: 0, min: -100, max: 100, def: 0, dp: 1 },
  { group: "Creative", id: "vibrance", name: "Vibrance", section: "Creative", nth: 0, min: -100, max: 100, def: 0, dp: 1, track: "vib" },
  { group: "Creative", id: "csat", name: "Saturation", section: "Creative", nth: 1, min: 0, max: 200, def: 100, dp: 1, track: "sat" },

  { group: "Vignette", id: "vamount", name: "Amount", section: "Vignette", nth: 0, min: -5, max: 5, def: 0, dp: 2 },
  { group: "Vignette", id: "vmid", name: "Midpoint", section: "Vignette", nth: 0, min: 0, max: 100, def: 50, dp: 1 },
  { group: "Vignette", id: "vround", name: "Roundness", section: "Vignette", nth: 0, min: -100, max: 100, def: 0, dp: 1 },
  { group: "Vignette", id: "vfeather", name: "Feather", section: "Vignette", nth: 0, min: 0, max: 100, def: 50, dp: 1 }
];
const BY_ID = {};
CONTROLS.forEach((c) => { BY_ID[c.id] = c; });

const GRADIENT_TRACKS = ["temp", "tint", "sat", "vib", "exp", "lift", "gain"];

/* ------------------------------------------------------------------ state */

const state = {
  project: null,
  clips: [],          // [{ item, chain, compIndex, map: {controlId: paramIndex}, lumetriCount }]
  signature: "",
  values: {},         // controlId -> number (from first clip)
  keyframed: {},      // controlId -> { onClip, hasKey, count } when that param is animated on the first clip
  sequence: null,
  playhead: null,     // sequence playhead, in ticks
  replaceNeedsRemove: undefined,
  interacting: false,
  lastWrite: 0,
  visible: true,
  refreshing: null,
  live: true
};

const rows = {};      // controlId -> { el, track, fill, thumb, valueEl, centre }

/* --------------------------------------------------------------- helpers */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const fmt = (c, v) => (v === null || v === undefined || isNaN(v)) ? "—" : Number(v).toFixed(c.dp);

function setStatus(text, mode) {
  document.getElementById("tn-statusText").textContent = text;
  const dot = document.getElementById("tn-statusDot");
  dot.className = "tn-dot" + (mode ? " tn-" + mode : "");
}

function logError(where, err) {
  console.error("[Tonal] " + where, err);
}

/* ----------------------------------------------------- premiere: reading */

async function getSelectedVideoClips(sequence) {
  const selection = await sequence.getSelection();
  const items = await selection.getTrackItems();
  return items.filter((it) => {
    try { return it instanceof ppro.VideoClipTrackItem; } catch (e) { return true; }
  });
}

async function signatureOf(items) {
  const parts = [];
  for (const it of items) {
    let name = "", start = "";
    try { name = await it.getName(); } catch (e) {}
    try { const t = await it.getStartTime(); start = t && t.ticks; } catch (e) {}
    parts.push(name + "@" + start);
  }
  return parts.join("|");
}

/** Work out which parameter index each control maps to on one Lumetri component. */
function buildParamMap(component) {
  const count = component.getParamCount();
  const occurrences = {};
  const byNth = {};
  const bySection = {};
  let section = null;
  let sectionsSeen = 0;

  for (let i = 0; i < count; i++) {
    let name = "";
    try { name = (component.getParam(i).displayName || "").trim(); } catch (e) { continue; }
    if (SECTION_NAMES.indexOf(name) !== -1) {
      section = name;
      sectionsSeen++;
      continue;
    }
    const n = occurrences[name] || 0;
    byNth[name + "#" + n] = i;
    occurrences[name] = n + 1;
    if (section) {
      const key = section + "/" + name;
      if (bySection[key] === undefined) bySection[key] = i;
    }
  }

  const map = {};
  for (const c of CONTROLS) {
    let idx;
    if (sectionsSeen >= 3) idx = bySection[c.section + "/" + c.name];
    if (idx === undefined) idx = byNth[c.name + "#" + c.nth];
    if (idx !== undefined) map[c.id] = idx;
  }
  return map;
}

/* ------------------------------------------------------- clip timing */

/*
 * Keyframes live in the clip's media time: a clip's first frame sits at its
 * In point, not at 0 and not at its place on the timeline. Slowed-down and
 * sped-up clips report their In/Out points in "stretched" time (source time
 * divided by speed) while their keyframes sit in real source time, so convert
 * back. (Same rules Dolly uses; measured in Premiere 2027.)
 */
const TPS = 254016000000;                // Premiere ticks per second
const KEY_TOLERANCE = 2000000000;        // ~8 ms: "a keyframe is at the playhead"

function tickTime(n) { return ppro.TickTime.createWithTicks(String(Math.round(n))); }

async function clipTiming(item) {
  const t = { ok: false };
  try {
    try { if (await item.isSpeedReversed()) { t.reversed = true; return t; } } catch (e) {}
    const inP = Number((await item.getInPoint()).ticks);
    const outP = Number((await item.getOutPoint()).ticks);
    t.startT = Number((await item.getStartTime()).ticks);
    t.endT = Number((await item.getEndTime()).ticks);
    let speed = 1;
    try { const sp = Number(await item.getSpeed()); if (sp > 0 && isFinite(sp)) speed = sp; } catch (e) {}
    const repIn = Math.min(inP, outP), repOut = Math.max(inP, outP);
    const durT = t.endT - t.startT;
    const stretched = Math.abs(speed - 1) > 1e-4 && durT > 0 && Math.abs((repOut - repIn) / durT - 1) < 0.02;
    t.inT = stretched ? repIn * speed : repIn;
    const outT = stretched ? repOut * speed : repOut;
    t.k = durT > 0 ? (outT - t.inT) / durT : 1;   // source time per timeline time
    t.ok = durT > 0 && t.k > 0;
  } catch (e) { logError("clipTiming", e); }
  return t;
}

/** The playhead in this clip's keyframe time, or null when the playhead isn't over the clip. */
function localTime(clip) {
  const t = clip.timing, ph = state.playhead;
  if (!t || !t.ok || typeof ph !== "number") return null;
  if (ph < t.startT || ph >= t.endT) return null;
  return Math.round(t.inT + (ph - t.startT) * t.k);
}

function keyTimes(p) {
  let list = [];
  try { list = p.getKeyframeListAsTickTimes() || []; } catch (e) {}
  return list.map((tt) => ({ ticks: Number(tt.ticks), time: tt }));
}

function keyNear(keys, ticks) {
  let best = null;
  for (const k of keys) {
    const d = Math.abs(k.ticks - ticks);
    if (d <= KEY_TOLERANCE && (!best || d < Math.abs(best.ticks - ticks))) best = k;
  }
  return best;
}

async function readPlayhead() {
  try {
    if (!state.sequence) return;
    const ph = await state.sequence.getPlayerPosition();
    state.playhead = Number(ph.ticks);
  } catch (e) {}
}

async function scanClip(item) {
  const chain = await item.getComponentChain();
  const count = chain.getComponentCount();
  let compIndex = -1;
  let lumetriCount = 0;
  for (let i = 0; i < count; i++) {
    const comp = chain.getComponentAtIndex(i);
    let mn = "";
    try { mn = await comp.getMatchName(); } catch (e) {}
    if (mn === LUMETRI) {
      lumetriCount++;
      if (compIndex === -1) compIndex = i;
    }
  }
  const map = compIndex >= 0 ? buildParamMap(chain.getComponentAtIndex(compIndex)) : {};
  const timing = await clipTiming(item);
  return { item, chain, compIndex, map, lumetriCount, timing };
}

/** Rebuild everything from the current selection. */
async function refresh() {
  if (state.refreshing) return state.refreshing;
  state.refreshing = (async () => {
    try {
      const project = await ppro.Project.getActiveProject();
      if (!project) { state.clips = []; state.signature = ""; renderEmpty("Open a project to begin."); return; }
      const sequence = await project.getActiveSequence();
      if (!sequence) { state.clips = []; state.signature = ""; renderEmpty("Open a sequence to begin."); return; }

      const items = await getSelectedVideoClips(sequence);
      state.project = project;
      state.sequence = sequence;
      state.signature = await signatureOf(items);
      await readPlayhead();

      if (!items.length) { state.clips = []; renderEmpty("Select a clip on the timeline."); return; }

      const clips = [];
      for (const it of items) {
        try { clips.push(await scanClip(it)); } catch (e) { logError("scanClip", e); }
      }
      state.clips = clips;
      await readValues();
      renderReady();
    } catch (e) {
      logError("refresh", e);
      setStatus("Couldn't read the timeline", "warn");
    } finally {
      state.refreshing = null;
    }
  })();
  return state.refreshing;
}

/** Read slider values from the first selected clip that has Lumetri. */
/*
 * state.keyframed[id] describes a keyframed (animated) parameter on the first clip:
 *   { onClip: playhead is over the clip, hasKey: a keyframe sits at the playhead }
 * Animated parameters show their value at the playhead, like Effect Controls.
 */
async function readValues() {
  const clip = state.clips.find((c) => c.compIndex >= 0);
  const values = {}, keyframed = {};
  if (!clip) {
    CONTROLS.forEach((c) => { values[c.id] = c.def; });
    state.values = values; state.keyframed = keyframed; state.firstClipLocal = null;
    return;
  }
  const comp = clip.chain.getComponentAtIndex(clip.compIndex);
  const t = localTime(clip);
  state.firstClipLocal = t;
  for (const c of CONTROLS) {
    const idx = clip.map[c.id];
    if (idx === undefined) { values[c.id] = null; continue; }
    try {
      const p = comp.getParam(idx);
      let v = null;
      if (p.isTimeVarying()) {
        const keys = keyTimes(p);
        // off the clip: show the value at the nearest edge of the clip
        const at = t !== null ? t : (clip.timing && clip.timing.ok ? Math.round(clip.timing.inT) : (keys[0] ? keys[0].ticks : 0));
        const r = await p.getValueAtTime(tickTime(at));
        v = r ? r.value : null;
        keyframed[c.id] = { onClip: t !== null, hasKey: t !== null && !!keyNear(keys, t), count: keys.length };
      } else {
        const kf = await p.getStartValue();
        v = kf && kf.value ? kf.value.value : null;
      }
      values[c.id] = (typeof v === "number") ? v : (v === null ? null : Number(v));
    } catch (e) {
      logError("read " + c.name, e);
      values[c.id] = null;
    }
  }
  state.values = values;
  state.keyframed = keyframed;
}

/* ----------------------------------------------------- premiere: writing */

async function addLumetriTo(clips) {
  const project = state.project;
  const comps = [];
  for (let i = 0; i < clips.length; i++) {
    comps.push(await ppro.VideoFilterFactory.createComponent(LUMETRI));
  }
  project.lockedAccess(() => {
    project.executeTransaction((ca) => {
      clips.forEach((clip, i) => ca.addAction(clip.chain.createAppendComponentAction(comps[i])));
    }, "Tonal: Add Lumetri Color");
  });
}

async function writeValues(changes, attempt) {
  attempt = attempt || 0;
  if (!state.clips.length || !state.project) return;

  // Any selected clip without Lumetri gets one first.
  const missing = state.clips.filter((c) => c.compIndex < 0);
  if (missing.length) {
    await addLumetriTo(missing);
    for (const clip of missing) {
      const fresh = await scanClip(clip.item);
      Object.assign(clip, fresh);
    }
    renderStatus();
  }

  const ids = Object.keys(changes);
  const label = "Tonal: " + ids.map((id) => BY_ID[id].name).join(", ");
  const project = state.project;

  let updatedExisting = false;
  try {
    project.lockedAccess(() => {
      project.executeTransaction((ca) => {
        for (const clip of state.clips) {
          if (clip.compIndex < 0) continue;
          const comp = clip.chain.getComponentAtIndex(clip.compIndex);
          const t = localTime(clip);
          for (const id of ids) {
            const idx = clip.map[id];
            if (idx === undefined) continue;
            const p = comp.getParam(idx);
            if (addValueActions(ca, p, Number(changes[id]), t)) updatedExisting = true;
          }
        }
      }, label);
    });
    if (state.replaceNeedsRemove === undefined && updatedExisting) await learnReplaceBehaviour(changes);
  } catch (e) {
    // Stale objects (e.g. the timeline changed underneath us): rescan once and retry.
    if (attempt === 0) {
      logError("write (retrying)", e);
      const keep = state.signature;
      await refresh();
      if (state.signature === keep) return writeValues(changes, 1);
    } else {
      throw e;
    }
  }
}

/*
 * Set a value the way Effect Controls does: a plain parameter gets the value;
 * a keyframed one gets a keyframe at the playhead (updating the keyframe that's
 * already there, if any). With the playhead off the clip, keyframed parameters
 * are left alone rather than keyframed somewhere you can't see.
 */
function addValueActions(ca, p, value, t) {
  if (!p.isTimeVarying()) {
    ca.addAction(p.createSetValueAction(p.createKeyframe(value), true));
    return false;
  }
  if (t === null) return false;
  const existing = keyNear(keyTimes(p), t);
  const at = existing ? existing.ticks : t;
  if (existing && state.replaceNeedsRemove) ca.addAction(p.createRemoveKeyframeAction(existing.time, true));
  const kf = p.createKeyframe(value);
  kf.position = tickTime(at);
  ca.addAction(p.createAddKeyframeAction(kf));
  return !!existing;   // true when this updates a keyframe that was already there
}

/*
 * Premiere's API doesn't say whether adding a keyframe where one already
 * exists replaces it. The first time Tonal updates an existing keyframe it
 * reads the value back; if the old value stuck, it switches to
 * remove-then-add for the rest of the session and redoes that one write.
 */
async function learnReplaceBehaviour(changes) {
  const clip = state.clips.find((c) => c.compIndex >= 0);
  if (!clip) return;
  const t = localTime(clip);
  if (t === null) return;
  const comp = clip.chain.getComponentAtIndex(clip.compIndex);
  for (const id of Object.keys(changes)) {
    const idx = clip.map[id];
    if (idx === undefined) continue;
    const p = comp.getParam(idx);
    if (!p.isTimeVarying()) continue;
    const keys = keyTimes(p);
    const k = keyNear(keys, t);
    if (!k) continue;
    let v = NaN;
    try { const r = await p.getValueAtTime(k.time); v = Number(r && r.value); } catch (e) { return; }
    const want = Number(changes[id]);
    if (Math.abs(v - want) < 1e-3) {
      state.replaceNeedsRemove = keys.length > 0 && !hasDuplicateKey(keys) ? false : true;
      if (state.replaceNeedsRemove) await tidyDuplicates(clip, comp);
      return;
    }
    state.replaceNeedsRemove = true;
    logError("keyframe update", "adding over an existing keyframe kept the old value; using remove + add");
    await writeValues(changes, 1);
    return;
  }
}

function hasDuplicateKey(keys) {
  const sorted = keys.map((k) => k.ticks).sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++) if (sorted[i] - sorted[i - 1] <= KEY_TOLERANCE) return true;
  return false;
}

/* If an add ever left two keyframes on top of each other, keep the newest value only. */
async function tidyDuplicates(clip, comp) {
  const project = state.project;
  try {
    project.lockedAccess(() => {
      project.executeTransaction((ca) => {
        for (const id of Object.keys(clip.map)) {
          const p = comp.getParam(clip.map[id]);
          if (!p.isTimeVarying()) continue;
          const keys = keyTimes(p).sort((a, b) => a.ticks - b.ticks);
          for (let i = 1; i < keys.length; i++) {
            if (keys[i].ticks - keys[i - 1].ticks <= KEY_TOLERANCE) ca.addAction(p.createRemoveKeyframeAction(keys[i - 1].time, true));
          }
        }
      }, "Tonal: tidy keyframes");
    });
  } catch (e) { logError("tidy", e); }
}

/* ------------------------------------------------------------ undo / redo */

/*
 * Premiere's API can't merge several changes into one undo step, so a live
 * drag leaves a trail of small steps in Premiere's own history. Tonal keeps
 * its own history instead: one entry per whole adjustment (a drag, a typed
 * number, a reset, a keyframe added or removed). Each entry holds a snapshot
 * of every selected clip's parameters from before it: the plain value, or the
 * full set of keyframes (times, values and interpolation) if it's animated.
 * Undo puts that snapshot back in a single change.
 */
const undoHistory = { done: [], undone: [], open: null, signature: "" };
const MERGE_MS = 450; // clicks that land this close together (e.g. a double-click reset) count as one adjustment

async function snapshotParam(clip, id) {
  if (clip.compIndex < 0 || clip.map[id] === undefined) return { tv: false, value: BY_ID[id].def };
  const p = clip.chain.getComponentAtIndex(clip.compIndex).getParam(clip.map[id]);
  if (!p.isTimeVarying()) {
    const kf = await p.getStartValue();
    const v = kf && kf.value ? Number(kf.value.value) : BY_ID[id].def;
    return { tv: false, value: v };
  }
  const keys = [];
  for (const k of keyTimes(p)) {
    let v = NaN, mode = null;
    try { v = Number(p.getKeyframePtr(k.time).value.value); } catch (e) {}
    if (!isFinite(v)) { try { const r = await p.getValueAtTime(k.time); v = Number(r && r.value); } catch (e) {} }
    try { mode = await p.getKeyframePtr(k.time).getTemporalInterpolationMode(); } catch (e) {}
    if (isFinite(v)) keys.push({ ticks: k.ticks, value: v, mode });
  }
  return { tv: true, keys };
}

async function snapshotClips(clips, ids) {
  const out = [];
  for (const clip of clips) {
    const snap = {};
    for (const id of ids) { try { snap[id] = await snapshotParam(clip, id); } catch (e) {} }
    out.push(snap);
  }
  return out;
}

/** Put parameters back exactly as a snapshot recorded them. */
async function restoreSnapshot(clips, snaps, label) {
  const project = state.project;
  if (!project) return;
  project.lockedAccess(() => {
    project.executeTransaction((ca) => {
      clips.forEach((clip, i) => {
        if (clip.compIndex < 0) return;
        const comp = clip.chain.getComponentAtIndex(clip.compIndex);
        for (const id of Object.keys(snaps[i] || {})) {
          const snap = snaps[i][id];
          const idx = clip.map[id];
          if (!snap || idx === undefined) continue;
          const p = comp.getParam(idx);
          const animated = p.isTimeVarying();
          if (snap.tv) {
            if (!animated) ca.addAction(p.createSetTimeVaryingAction(true));
            keyTimes(p).forEach((k) => ca.addAction(p.createRemoveKeyframeAction(k.time, true)));
            snap.keys.forEach((k) => {
              const kf = p.createKeyframe(k.value);
              kf.position = tickTime(k.ticks);
              ca.addAction(p.createAddKeyframeAction(kf));
            });
          } else {
            if (animated) ca.addAction(p.createSetTimeVaryingAction(false));
            ca.addAction(p.createSetValueAction(p.createKeyframe(snap.value), true));
          }
        }
      });
    }, label);
  });

  // Second pass: drop any keyframe Premiere added by itself (e.g. when keyframing
  // switched on) and put interpolation (linear, Bezier, hold…) back.
  const tidy = [];
  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i];
    if (clip.compIndex < 0) continue;
    const comp = clip.chain.getComponentAtIndex(clip.compIndex);
    for (const id of Object.keys(snaps[i] || {})) {
      const snap = snaps[i][id];
      if (!snap || !snap.tv || clip.map[id] === undefined) continue;
      const p = comp.getParam(clip.map[id]);
      for (const k of keyTimes(p)) {
        const want = snap.keys.find((w) => Math.abs(w.ticks - k.ticks) <= KEY_TOLERANCE);
        if (!want) { tidy.push((ca) => ca.addAction(p.createRemoveKeyframeAction(k.time, true))); continue; }
        if (want.mode === null || want.mode === undefined) continue;
        let mode = null;
        try { mode = await p.getKeyframePtr(k.time).getTemporalInterpolationMode(); } catch (e) {}
        if (mode !== want.mode) tidy.push((ca) => ca.addAction(p.createSetInterpolationAtKeyframeAction(k.time, want.mode, true)));
      }
    }
  }
  if (tidy.length) {
    try {
      project.lockedAccess(() => {
        project.executeTransaction((ca) => tidy.forEach((fn) => fn(ca)), label);
      });
    } catch (e) { logError("restore tidy", e); }
  }
}

function beginGesture(ids) {
  if (undoHistory.open || !state.clips.length) return;
  if (undoHistory.signature !== state.signature) { undoHistory.done = []; undoHistory.undone = []; undoHistory.signature = state.signature; }
  const g = { ids: ids.slice(), clips: state.clips.slice(), started: Date.now(), wrote: false };
  g.ready = readPlayhead().then(() => snapshotClips(g.clips, g.ids)).then((b) => { g.before = b; }, (e) => { logError("snapshot", e); g.before = []; });
  undoHistory.open = g;
}

function endGesture() {
  const g = undoHistory.open;
  undoHistory.open = null;
  if (!g || !g.wrote) return;
  g.ended = Date.now();
  const last = undoHistory.done[undoHistory.done.length - 1];
  if (last && g.started - last.ended < MERGE_MS && g.ids.join() === last.ids.join()) {
    last.ended = g.ended;                  // fold into the previous adjustment
  } else {
    undoHistory.done.push(g);
  }
  undoHistory.undone = [];
  renderHistoryButtons();
}

async function undo() {
  const g = undoHistory.done.pop();
  if (!g) return;
  await waitForWrites();
  await g.ready;
  try {
    g.after = await snapshotClips(g.clips, g.ids);
    await restoreSnapshot(g.clips, g.before || [], "Tonal: Undo");
    undoHistory.undone.push(g);
  } catch (e) {
    logError("undo", e);
    setStatus("Couldn't undo — the clips may have changed", "warn");
  }
  state.lastWrite = Date.now();
  await readValues();
  paintAll();
  renderHistoryButtons();
}

async function redo() {
  const g = undoHistory.undone.pop();
  if (!g || !g.after) return;
  await waitForWrites();
  try {
    await restoreSnapshot(g.clips, g.after, "Tonal: Redo");
    undoHistory.done.push(g);
  } catch (e) {
    logError("redo", e);
  }
  state.lastWrite = Date.now();
  await readValues();
  paintAll();
  renderHistoryButtons();
}

async function waitForWrites() {
  while (flushing || Object.keys(pending).length) await sleep(20);
}

function renderHistoryButtons() {
  const u = document.getElementById("tn-undo");
  if (u) toggleClass(u, "tn-off", !undoHistory.done.length);
}

/* Coalesce rapid slider moves into as few transactions as possible. */
/*
 * Premiere applies each change on the same thread that draws this panel, so
 * sending one per mouse event makes the slider stutter. Instead, the latest
 * value is sent at a steady pace (about 15 times a second) while dragging,
 * and the final value is sent the moment you let go.
 */
const WRITE_INTERVAL = 66;
let pending = {};
let flushing = false;
let lastFlushStart = 0;

function queueWrite(id, value) {
  if (undoHistory.open) undoHistory.open.wrote = true;
  pending[id] = value;
  if (!flushing) flush();
}

async function flush() {
  flushing = true;
  try {
    while (Object.keys(pending).length) {
      const wait = WRITE_INTERVAL - (Date.now() - lastFlushStart);
      if (wait > 0 && state.interacting) await sleep(wait);
      // let the panel draw the thumb's new position before Premiere takes the thread
      if (state.interacting) await new Promise((r) => nextFrame(() => setTimeout(r, 0)));
      if (undoHistory.open) await undoHistory.open.ready; // snapshot "before" values first
      const batch = pending;
      pending = {};
      lastFlushStart = Date.now();
      try {
        await writeValues(batch);
      } catch (e) {
        logError("write", e);
        setStatus("Premiere refused that change — see diagnostics", "warn");
      }
      state.lastWrite = Date.now();
      await sleep(0); // let the panel catch up on drawing
    }
  } finally {
    flushing = false;
  }
}

/* ------------------------------------------------------------------- UI */

function toggleClass(node, cls, on) {
  if (on) node.classList.add(cls); else node.classList.remove(cls);
}
function all(selector) {
  return Array.prototype.slice.call(document.querySelectorAll(selector));
}
function swap(oldNode, newNode) {
  if (oldNode.parentNode) oldNode.parentNode.replaceChild(newNode, oldNode);
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function buildUI() {
  const root = document.getElementById("tn-controls");
  root.innerHTML = "";

  const groups = [];
  CONTROLS.forEach((c) => { if (groups.indexOf(c.group) === -1) groups.push(c.group); });

  groups.forEach((g) => {
    const section = el("div", "tn-section");
    const head = el("div", "tn-section-head");
    head.appendChild(el("span", "tn-section-title", g.toUpperCase()));
    const chev = el("span", "tn-chev", "–");
    head.appendChild(chev);
    head.addEventListener("click", () => {
      const collapsed = !section.classList.contains("tn-collapsed");
      toggleClass(section, "tn-collapsed", collapsed);
      chev.textContent = collapsed ? "+" : "–";
      if (!collapsed) setTimeout(paintAll, 0);
    });
    section.appendChild(head);

    const body = el("div", "tn-section-body");
    let lastSub = null;
    CONTROLS.filter((c) => c.group === g).forEach((c) => {
      if (c.sub && c.sub !== lastSub) {
        body.appendChild(el("div", "tn-sub", c.sub.toUpperCase()));
        lastSub = c.sub;
      }
      body.appendChild(buildRow(c));
    });
    section.appendChild(body);
    root.appendChild(section);
  });

  const empty = el("div", "tn-empty tn-hidden");
  empty.id = "tn-empty";
  root.appendChild(empty);
}

function buildRow(c) {
  const row = el("div", "tn-row");
  const head = el("div", "tn-row-head");
  const label = el("span", "tn-label", c.name);
  const right = el("div", "tn-right");
  const kf = el("span", "tn-key", "◇");
  kf.title = "Add a keyframe at the playhead";
  const resetDot = el("div", "tn-reset");
  resetDot.title = "Reset";
  const valueEl = el("span", "tn-value", fmt(c, c.def));
  right.appendChild(kf);
  right.appendChild(resetDot);
  right.appendChild(valueEl);
  head.appendChild(label);
  head.appendChild(right);

  const isGrad = c.track && GRADIENT_TRACKS.indexOf(c.track) !== -1;
  const track = el("div", "tn-track" + (isGrad ? " tn-grad tn-" + c.track : ""));
  const line = el("div", "tn-line");
  const fill = el("div", "tn-fill");
  const centre = el("div", "tn-centre");
  const thumb = el("div", "tn-thumb");
  track.appendChild(line);
  track.appendChild(fill);
  // a centre tick shows where "no change" sits on two-way sliders
  if (c.def > c.min && c.def < c.max) track.appendChild(centre);
  track.appendChild(thumb);

  row.appendChild(head);
  row.appendChild(track);

  rows[c.id] = { row, track, fill, thumb, valueEl, kf, centre };

  attachDrag(c, track, row);
  label.addEventListener("dblclick", () => adjust(c, c.def));
  track.addEventListener("dblclick", () => adjust(c, c.def));
  resetDot.addEventListener("click", () => adjust(c, c.def));
  kf.addEventListener("click", () => toggleKeyframe(c));
  valueEl.addEventListener("click", () => beginTyping(c, valueEl));

  return row;
}

function pct(c, v) {
  return ((clamp(v, c.min, c.max) - c.min) / (c.max - c.min)) * 100;
}

function paint(c, exact) {
  const r = rows[c.id];
  if (!r) return;
  const v = state.values[c.id];
  const has = typeof v === "number" && !isNaN(v);
  // while dragging, the thumb follows the mouse exactly; the number shows the rounded value
  const p = typeof exact === "number" ? pct(c, exact) : (has ? pct(c, v) : pct(c, c.def));
  const d = pct(c, c.def);
  // Position in pixels: percentage offsets inside absolutely-positioned boxes
  // aren't reliable in Premiere's layout engine.
  const w = trackWidth(r);
  if (w > 0) {
    r.thumb.style.left = (p / 100) * w + "px";
    r.fill.style.left = (Math.min(p, d) / 100) * w + "px";
    r.fill.style.width = (Math.abs(p - d) / 100) * w + "px";
    r.centre.style.left = (d / 100) * w + "px";
  } else {
    r.thumb.style.left = p + "%";
    r.fill.style.left = Math.min(p, d) + "%";
    r.fill.style.width = Math.abs(p - d) + "%";
    r.centre.style.left = d + "%";
  }
  if (r.valueEl.tagName !== "INPUT") r.valueEl.textContent = has ? fmt(c, v) : "—";
  const changed = has && Math.abs(v - c.def) > Math.pow(10, -c.dp) / 2;
  toggleClass(r.row, "tn-changed", changed);
  const k = state.keyframed[c.id];
  const offClip = state.firstClipLocal === null || state.firstClipLocal === undefined;
  r.kf.textContent = k && k.hasKey ? "◆" : "◇";
  toggleClass(r.kf, "tn-key-on", !!k);
  toggleClass(r.kf, "tn-key-here", !!(k && k.hasKey));
  toggleClass(r.kf, "tn-key-off", offClip || !state.clips.some((cl) => cl.compIndex >= 0));
  r.kf.title = offClip ? "Move the playhead over the clip to keyframe"
    : !k ? "Start keyframing: adds a keyframe at the playhead"
    : k.hasKey ? "Remove the keyframe at the playhead" : "Add a keyframe at the playhead";
  // A keyframed setting can only be changed with the playhead over the clip (it sets a keyframe there).
  const usable = state.clips.length > 0 && !(k && !k.onClip) && (state.clips.every((cl) => cl.compIndex < 0) || has);
  toggleClass(r.row, "tn-disabled", !usable);
}

// Measuring layout is slow, so each track's width is measured once and reused
// until the panel is resized or a section is opened.
function trackWidth(r) {
  if (r.w) return r.w;
  let w = 0;
  try { w = r.track.getBoundingClientRect().width; } catch (e) {}
  if (!w) w = r.track.offsetWidth || r.track.clientWidth || 0;
  r.w = w;
  return w;
}

function remeasure() { Object.keys(rows).forEach((id) => { rows[id].w = 0; }); }

function paintAll() {
  remeasure();
  CONTROLS.forEach((c) => paint(c));
  if (typeof window.tonalValuesChanged === "function") window.tonalValuesChanged();
}

const nextFrame = (typeof requestAnimationFrame === "function")
  ? (fn) => requestAnimationFrame(fn)
  : (fn) => setTimeout(fn, 16);

function isLocked(c) {
  const k = state.keyframed[c.id];
  return !!(k && !k.onClip);
}

function commit(c, value, exact, noWrite) {
  if (!state.clips.length || isLocked(c)) return;
  state.lastTouched = c.id;
  const v = Number(clamp(value, c.min, c.max).toFixed(c.dp));
  const same = state.values[c.id] === v;
  state.values[c.id] = v;
  const k = state.keyframed[c.id];
  if (k && k.onClip && !noWrite) k.hasKey = true;   // a move on a keyframed setting leaves a keyframe at the playhead
  paint(c, exact);
  if (noWrite) { dirty[c.id] = true; return; }
  if (!same || dirty[c.id]) { dirty[c.id] = false; queueWrite(c.id, v); } // only bother Premiere when the number changes
  if (typeof window.tonalValuesChanged === "function") window.tonalValuesChanged(c.id);
}
const dirty = {}; // values shown but not yet sent (Live off while dragging)

/** A single, complete adjustment: one entry in Tonal's undo undoHistory. */
function adjust(c, value) {
  beginGesture([c.id]);
  commit(c, value);
  endGesture();
}

/*
 * The diamond beside each value works like the one in Effect Controls:
 *   not keyframed yet   → turns keyframing on with a keyframe at the playhead
 *   keyframe at playhead → removes it
 *   otherwise            → adds a keyframe at the playhead with the current value
 * Turning keyframing off altogether (which deletes every keyframe) is left to
 * Effect Controls' stopwatch, so it can't happen by accident here.
 */
async function toggleKeyframe(c) {
  if (!state.clips.length || state.firstClipLocal === null || state.firstClipLocal === undefined) return;
  if (!state.clips.some((cl) => cl.compIndex >= 0)) return;
  await waitForWrites();
  beginGesture([c.id]);
  const g = undoHistory.open;
  if (g) { g.wrote = true; await g.ready; }

  // Work out each clip's job before touching anything (reads are async, transactions aren't).
  const jobs = [];
  for (const clip of state.clips) {
    if (clip.compIndex < 0 || clip.map[c.id] === undefined) continue;
    const t = localTime(clip);
    if (t === null) continue;
    const p = clip.chain.getComponentAtIndex(clip.compIndex).getParam(clip.map[c.id]);
    const animated = p.isTimeVarying();
    const here = animated ? keyNear(keyTimes(p), t) : null;
    let value = NaN;
    try {
      if (animated) { const r = await p.getValueAtTime(tickTime(t)); value = Number(r && r.value); }
      else { const kf = await p.getStartValue(); value = Number(kf && kf.value ? kf.value.value : NaN); }
    } catch (e) {}
    if (!isFinite(value)) value = typeof state.values[c.id] === "number" ? state.values[c.id] : c.def;
    jobs.push({ clip, p, t, animated, here, value });
  }
  const project = state.project;
  const label = "Tonal: " + c.name + " keyframe";
  try {
    project.lockedAccess(() => {
      project.executeTransaction((ca) => {
        for (const j of jobs) {
          if (!j.animated) ca.addAction(j.p.createSetTimeVaryingAction(true));
          if (j.here) { ca.addAction(j.p.createRemoveKeyframeAction(j.here.time, true)); continue; }
          const kf = j.p.createKeyframe(j.value);
          kf.position = tickTime(j.t);
          ca.addAction(j.p.createAddKeyframeAction(kf));
        }
      }, label);
    });
    // Switching keyframing on can make Premiere drop its own keyframe (at the clip start,
    // say). Keep only the one at the playhead, as Effect Controls would.
    const extras = [];
    for (const j of jobs) {
      if (j.animated) continue;
      for (const k of keyTimes(j.p)) if (Math.abs(k.ticks - j.t) > KEY_TOLERANCE) extras.push({ p: j.p, time: k.time });
    }
    if (extras.length) {
      project.lockedAccess(() => {
        project.executeTransaction((ca) => extras.forEach((x) => ca.addAction(x.p.createRemoveKeyframeAction(x.time, true))), label);
      });
    }
  } catch (e) {
    logError("keyframe", e);
    setStatus("Premiere refused that keyframe — see diagnostics", "warn");
  }
  endGesture();
  state.lastWrite = Date.now();
  await readValues();
  paintAll();
}

/* Drag handling — pointer events where available, mouse events otherwise. */
const HAS_POINTER = typeof window !== "undefined" && "PointerEvent" in window;
const EV_DOWN = HAS_POINTER ? "pointerdown" : "mousedown";
const EV_MOVE = HAS_POINTER ? "pointermove" : "mousemove";
const EV_UP = HAS_POINTER ? "pointerup" : "mouseup";

function attachDrag(c, track, row) {
  track.addEventListener(EV_DOWN, (e) => {
    if (row.classList.contains("tn-disabled")) return;
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();

    const rect = track.getBoundingClientRect();
    rows[c.id].w = rect.width;
    const range = c.max - c.min;
    let lastX = e.clientX;
    let current = state.values[c.id];
    if (typeof current !== "number") current = c.def;

    beginGesture([c.id]);

    // Clicking off the thumb jumps there; grabbing the thumb keeps the value.
    const thumbX = rect.left + (pct(c, current) / 100) * rect.width;
    if (Math.abs(e.clientX - thumbX) > 7 && !e.shiftKey) {
      current = c.min + ((e.clientX - rect.left) / rect.width) * range;
      commit(c, current, current, !state.live);
    }

    state.interacting = true;
    row.classList.add("tn-dragging");
    try { if (HAS_POINTER && track.setPointerCapture) track.setPointerCapture(e.pointerId); } catch (err) {}

    // Mouse events can arrive faster than the screen redraws; gather them and
    // draw once per frame.
    let framePending = false;
    const move = (ev) => {
      const dx = ev.clientX - lastX;
      lastX = ev.clientX;
      const scale = ev.shiftKey ? 0.1 : 1;
      current = clamp(current + (dx / rect.width) * range * scale, c.min, c.max);
      if (framePending) return;
      framePending = true;
      nextFrame(() => {
        framePending = false;
        commit(c, current, current, !state.live);
      });
    };
    const up = () => {
      state.interacting = false;
      commit(c, current); // send the final value and settle the thumb on it
      if (!flushing && Object.keys(pending).length) flush();
      endGesture();
      row.classList.remove("tn-dragging");
      document.removeEventListener(EV_MOVE, move);
      document.removeEventListener(EV_UP, up);
    };
    document.addEventListener(EV_MOVE, move);
    document.addEventListener(EV_UP, up);
  });
}

function beginTyping(c, valueEl) {
  if (!state.clips.length || isLocked(c)) return;
  const input = document.createElement("input");
  input.type = "text";
  input.className = "tn-value-input";
  input.value = valueEl.textContent === "—" ? "" : valueEl.textContent;
  swap(valueEl, input);
  rows[c.id].valueEl = input;
  state.interacting = true;
  try { input.focus(); input.select && input.select(); } catch (e) {}

  let done = false;
  const finish = (save) => {
    if (done) return;
    done = true;
    state.interacting = false;
    swap(input, valueEl);
    rows[c.id].valueEl = valueEl;
    const n = parseFloat(input.value);
    if (save && !isNaN(n)) adjust(c, n); else paint(c);
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") finish(true);
    if (e.key === "Escape") finish(false);
  });
  input.addEventListener("blur", () => finish(true));
}

function renderStatus() {
  const n = state.clips.length;
  const withL = state.clips.filter((c) => c.compIndex >= 0).length;
  const clipWord = n === 1 ? "1 clip" : n + " clips";
  if (!n) return;
  if (withL === 0) setStatus(clipWord + " · Lumetri added on first move", "warn");
  else if (withL < n) setStatus(clipWord + " · " + (n - withL) + " without Lumetri (will add)", "warn");
  else {
    const multi = state.clips.some((c) => c.lumetriCount > 1);
    setStatus(clipWord + (multi ? " · editing first Lumetri" : " · Lumetri"), "on");
  }
}

function renderReady() {
  document.getElementById("tn-empty").classList.add("tn-hidden");
  all(".tn-section").forEach((s) => s.classList.remove("tn-hidden"));
  renderStatus();
  paintAll();
  setTimeout(paintAll, 50);
  if (!document.getElementById("tn-diag").classList.contains("tn-hidden")) renderDiagnostics();
}

function renderEmpty(message) {
  const empty = document.getElementById("tn-empty");
  empty.textContent = message;
  empty.classList.remove("tn-hidden");
  all(".tn-section").forEach((s) => s.classList.add("tn-hidden"));
  setStatus("No clip selected", "");
}

/* ----------------------------------------------------------- diagnostics */

async function renderDiagnostics() {
  const out = document.getElementById("tn-diagText");
  const clip = state.clips.find((c) => c.compIndex >= 0);
  if (!clip) { out.value = "Select a clip with Lumetri Color applied."; return; }
  const lines = [];
  const comp = clip.chain.getComponentAtIndex(clip.compIndex);
  const count = comp.getParamCount();
  const mappedTo = {};
  Object.keys(clip.map).forEach((id) => { mappedTo[clip.map[id]] = BY_ID[id].group + " › " + BY_ID[id].name; });
  lines.push("Lumetri params: " + count + " · component index " + clip.compIndex);
  const tm = clip.timing || {};
  lines.push("Playhead: " + state.playhead + " · clip " + tm.startT + "–" + tm.endT + " · in " + tm.inT + " · speed×" + (tm.k ? tm.k.toFixed(3) : "?") + " · keyframe time " + localTime(clip));
  lines.push("Updating keyframes: " + (state.replaceNeedsRemove === undefined ? "not tried yet" : state.replaceNeedsRemove ? "remove + add" : "add replaces"));
  lines.push("");
  for (let i = 0; i < count; i++) {
    let name = "", val = "", tv = "";
    try {
      const p = comp.getParam(i);
      name = p.displayName;
      tv = p.isTimeVarying() ? " [keyframed: " + keyTimes(p).length + " keys]" : "";
      const kf = await p.getStartValue();
      val = kf && kf.value ? JSON.stringify(kf.value.value) : String(kf);
    } catch (e) { val = "error: " + e; }
    if (val && val.length > 40) val = val.slice(0, 40) + "…";
    lines.push(String(i).padStart(3, " ") + "  " + (name || "(unnamed)") + " = " + val + tv + (mappedTo[i] ? "   ← " + mappedTo[i] : ""));
  }
  const unmapped = CONTROLS.filter((c) => clip.map[c.id] === undefined).map((c) => c.group + " › " + c.name);
  if (unmapped.length) { lines.push(""); lines.push("Not found: " + unmapped.join(", ")); }
  out.value = lines.join("\n");
}

/* --------------------------------------------------------- update check */

/*
 * Once at launch and then every few hours, Tonal reads a small version file
 * from jordanmansfield.dev. If a newer version exists it shows a quiet notice
 * with a Download button (opens the download page in the browser). Nothing is
 * installed automatically, and if the site can't be reached nothing happens.
 */
const UPDATE_URL = "https://jordanmansfield.dev/downloads/tonal/version.json";
const BUILT_IN_VERSION = "1.3.0";
const UPDATE_EVERY_MS = 6 * 60 * 60 * 1000;

function currentVersion() {
  try {
    const v = require("uxp").versions.plugin;
    if (v) return String(v);
  } catch (e) {}
  return BUILT_IN_VERSION;
}

function newerThan(a, b) {
  const pa = String(a).split(".").map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x !== y) return x > y;
  }
  return false;
}

function storeGet(key) { try { return window.localStorage.getItem(key); } catch (e) { return null; } }
function storeSet(key, v) { try { window.localStorage.setItem(key, v); } catch (e) {} }

let updateInfo = null;

async function checkForUpdate() {
  try {
    const res = await fetch(UPDATE_URL + "?t=" + Date.now(), { cache: "no-store" });
    if (!res.ok) return;
    const info = await res.json();
    if (!info || !info.version || !newerThan(info.version, currentVersion())) return;
    if (storeGet("tonal.dismissed") === info.version) return;
    updateInfo = info;
    const text = "Tonal " + info.version + " is available" + (info.summary ? " · " + info.summary : "");
    document.getElementById("tn-updateText").textContent = text;
    document.getElementById("tn-update").classList.remove("tn-hidden");
  } catch (e) {
    // offline or site unreachable: stay quiet
  }
}

function wireUpdate() {
  document.getElementById("tn-updateGet").addEventListener("click", async () => {
    const url = (updateInfo && updateInfo.page) || "https://jordanmansfield.dev/tonal";
    try { await require("uxp").shell.openExternal(url, "Opens the Tonal download page"); }
    catch (e) { logError("openExternal", e); }
  });
  document.getElementById("tn-updateDismiss").addEventListener("click", () => {
    if (updateInfo) storeSet("tonal.dismissed", updateInfo.version);
    document.getElementById("tn-update").classList.add("tn-hidden");
  });
  checkForUpdate();
  setInterval(checkForUpdate, UPDATE_EVERY_MS);
}

/* ------------------------------------------------------------- lifecycle */

function wireChrome() {
  state.live = storeGet("tonal.live") !== "0";
  document.getElementById("tn-resetAll").addEventListener("click", () => {
    if (!state.clips.length) return;
    // Keyframed settings are reset at the playhead (a keyframe at the default), like Effect Controls.
    const ids = CONTROLS.filter((c) => !isLocked(c) && state.values[c.id] !== c.def).map((c) => c.id);
    if (!ids.length && state.clips.length < 2) return;
    beginGesture(ids.length ? ids : CONTROLS.filter((c) => !isLocked(c)).map((c) => c.id));
    if (undoHistory.open) undoHistory.open.wrote = true;
    CONTROLS.forEach((c) => {
      if (isLocked(c)) return;
      state.values[c.id] = c.def; pending[c.id] = c.def;
    });
    endGesture();
    paintAll();
    if (!flushing) flush();
  });

  document.getElementById("tn-undo").addEventListener("click", () => undo());

  const liveBtn = document.getElementById("tn-live");
  const paintLive = () => toggleClass(liveBtn, "tn-active", state.live);
  window.tonalToggleLive = () => liveBtn.click();
  liveBtn.addEventListener("click", () => {
    state.live = !state.live;
    storeSet("tonal.live", state.live ? "1" : "0");
    paintLive();
  });
  paintLive();

  // Cmd/Ctrl+Z and Shift+Cmd/Ctrl+Z while the panel has focus
  document.addEventListener("keydown", (e) => {
    const tag = e.target && e.target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    if (!(e.metaKey || e.ctrlKey)) return;
    const k = (e.key || "").toLowerCase();
    if (k === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
    else if (k === "y") { e.preventDefault(); redo(); }
  });
  renderHistoryButtons();

  const diagBtn = document.getElementById("tn-toggleDiag");
  diagBtn.addEventListener("click", () => {
    const d = document.getElementById("tn-diag");
    toggleClass(d, "tn-hidden", !d.classList.contains("tn-hidden"));
    toggleClass(diagBtn, "tn-active", !d.classList.contains("tn-hidden"));
    if (!d.classList.contains("tn-hidden")) renderDiagnostics();
  });
  document.getElementById("tn-diagRefresh").addEventListener("click", renderDiagnostics);
}

function listenForSelection() {
  try {
    ppro.EventManager.addGlobalEventListener(ppro.Constants.SequenceEvent.SELECTION_CHANGED, () => {
      if (!state.interacting) refresh();
    });
  } catch (e) { logError("selection listener", e); }
  try {
    ppro.EventManager.addGlobalEventListener(ppro.Constants.SequenceEvent.ACTIVATED, () => refresh());
  } catch (e) {}
}

/*
 * Light polling as a safety net: catches selection changes the event misses,
 * and picks up edits made in Effect Controls so the sliders never lie.
 */
async function poll() {
  for (;;) {
    // Keyframed settings change as the playhead moves, so look more often while any are shown.
    await sleep(Object.keys(state.keyframed).length ? 250 : 900);
    if (!state.visible || state.interacting || flushing || state.refreshing) continue;
    if (Date.now() - state.lastWrite < 700) continue;
    try {
      const project = await ppro.Project.getActiveProject();
      const sequence = project && await project.getActiveSequence();
      if (!sequence) { if (state.clips.length || state.signature) await refresh(); continue; }
      const items = await getSelectedVideoClips(sequence);
      const sig = await signatureOf(items);
      if (sig !== state.signature) { await refresh(); continue; }
      if (state.clips.length) {
        // effects may have been added/removed in Premiere since the last scan
        const first = state.clips[0];
        const fresh = await scanClip(first.item);
        if (fresh.compIndex !== first.compIndex || fresh.lumetriCount !== first.lumetriCount) { await refresh(); continue; }
        first.timing = fresh.timing;   // picks up trims
        if (state.interacting || flushing) continue;
        await readPlayhead();
        await readValues();
        if (!state.interacting && !flushing) paintAll();
      }
    } catch (e) {
      // Usually a stale object after an edit; a full refresh sorts it.
      try { await refresh(); } catch (err) {}
    }
  }
}

function setupEntrypoints() {
  try {
    const { entrypoints } = require("uxp");
    entrypoints.setup({
      panels: {
        tonal: {
          show() { state.visible = true; refresh(); },
          hide() { state.visible = false; }
        }
      }
    });
  } catch (e) { /* older hosts: panel just stays live */ }
}

setupEntrypoints();
window.addEventListener("resize", () => paintAll());
// layout can settle after first paint — repaint a couple of times so pixel positions are right
setTimeout(paintAll, 100);
setTimeout(paintAll, 600);
buildUI();
wireChrome();
wireUpdate();
renderEmpty("Looking for a clip…");
listenForSelection();
refresh();
poll();
