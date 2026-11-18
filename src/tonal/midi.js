/*
 * Tonal MIDI — drive Tonal's sliders from a hardware controller (e.g. Behringer
 * X-Touch Mini).
 *
 * Premiere plugins can't read MIDI devices, so a small companion app, Tonal
 * Bridge, reads the controller and passes each knob, fader and button message
 * to this panel over a local connection (127.0.0.1:51849). Tonal sends values
 * back so LED rings follow the grade when you switch clips or undo.
 *
 * Mappings are made with "Learn": click Learn beside a control, then turn a
 * knob or press a button. They're saved with the panel, so they survive
 * restarts.
 *
 *   knob / fader → a slider: moves that setting
 *   button / knob push → a slider: resets that setting to its default
 *   button → an action: Undo, Redo, Reset all, Live on/off, and the
 *            "last adjusted" actions (reset it, keyframe it)
 */
(function () {
  const BRIDGE_URL = "ws://127.0.0.1:51849";
  const STORE_KEY = "tonal.midi.v1";
  const GESTURE_IDLE_MS = 600;     // a knob counts as "let go" after this long without movement
  const LEARN_TIMEOUT_MS = 15000;
  const FINE = 0.25;               // Fine mode: each knob step moves a quarter as far as Absolute

  const ACTIONS = [
    { id: "a:undo", name: "Undo", run: () => undo() },
    { id: "a:redo", name: "Redo", run: () => redo() },
    { id: "a:resetAll", name: "Reset all", run: () => document.getElementById("tn-resetAll").click() },
    { id: "a:live", name: "Live on / off", run: () => window.tonalToggleLive && window.tonalToggleLive() },
    { id: "a:resetLast", name: "Reset last adjusted", run: () => { const c = lastControl(); if (c) adjust(c, c.def); } },
    { id: "a:keyLast", name: "Keyframe last adjusted", run: () => { const c = lastControl(); if (c) toggleKeyframe(c); } },
  ];
  const ACTION_BY_ID = {};
  ACTIONS.forEach((a) => { ACTION_BY_ID[a.id] = a; });

  /* mode: how a knob/fader message becomes a value
   *   abs    knob position = value (LED ring shows it)
   *   fine   like abs, but each step moves a quarter as far
   *   rel    relative/endless encoders that send "turned up"/"turned down"
   *   fader  pickup: ignored until the fader passes the current value, so nothing jumps */
  const MODES = ["abs", "fine", "rel", "fader"];
  const MODE_LABEL = { abs: "ABS", fine: "FINE", rel: "REL", fader: "FADER" };
  const MODE_HELP = {
    abs: "Absolute: the knob's position sets the value",
    fine: "Fine: like Absolute, but each step moves a quarter as far",
    rel: "Relative: for endless encoders that send up/down steps",
    fader: "Fader: picks up only when the fader passes the current value, so nothing jumps",
  };

  const midi = {
    ws: null,
    connected: false,
    devices: [],
    bridgeVersion: "",
    map: {},            // key -> { target, mode }
    learning: null,     // { target, kind: "slider"|"action", until, samples: [] }
    lastIn: {},         // key -> last raw value received (for Fine and Fader)
    lastOut: {},        // key -> last value sent back to the controller
    picked: {},         // key -> true once a fader has caught up with the value
    gestureTimer: null,
    gestureTarget: null,
    acc: null,          // unrounded value of the knob being turned
  };

  /* ------------------------------------------------------------ storage */

  function load() {
    try { const raw = window.localStorage.getItem(STORE_KEY); if (raw) midi.map = JSON.parse(raw).map || {}; } catch (e) {}
  }
  function save() {
    try { window.localStorage.setItem(STORE_KEY, JSON.stringify({ map: midi.map })); } catch (e) {}
  }

  /* ------------------------------------------------------------- helpers */

  function keyOf(m) {
    return m.t === "pb" ? ["pb", m.dev || "", m.ch].join("|") : [m.t, m.dev || "", m.ch, m.n].join("|");
  }
  function parseKey(k) {
    const p = k.split("|");
    return { t: p[0], dev: p[1], ch: Number(p[2]), n: p[3] === undefined ? null : Number(p[3]) };
  }
  function describeKey(k) {
    const p = parseKey(k);
    if (p.t === "cc") return "CC " + p.n;
    if (p.t === "note") return "Button " + p.n;
    return "Fader " + p.ch;
  }
  function lastControl() { return state.lastTouched ? BY_ID[state.lastTouched] : null; }
  function bindingsFor(target) {
    return Object.keys(midi.map).filter((k) => midi.map[k].target === target);
  }
  function send(obj) {
    if (!midi.connected || !midi.ws) return;
    try { midi.ws.send(JSON.stringify(obj)); } catch (e) {}
  }

  /* --------------------------------------------------------- connection */

  function connect() {
    let ws;
    try { ws = new WebSocket(BRIDGE_URL); } catch (e) { retry(); return; }
    midi.ws = ws;
    ws.onopen = () => { midi.connected = true; render(); sendFeedback(true); };
    ws.onmessage = (ev) => {
      let m;
      try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.t === "hello") { midi.bridgeVersion = m.version || ""; midi.devices = m.devices || []; render(); sendFeedback(true); return; }
      if (m.t === "devices") { midi.devices = m.devices || []; render(); sendFeedback(true); return; }
      if (m.t === "cc" || m.t === "note" || m.t === "pb") onMessage(m);
    };
    ws.onclose = () => {
      const was = midi.connected;
      midi.connected = false; midi.ws = null; midi.devices = [];
      if (was) render();
      retry();
    };
    ws.onerror = () => { /* onclose follows */ };
  }
  let retryTimer = null;
  function retry() {
    if (retryTimer) return;
    retryTimer = setTimeout(() => { retryTimer = null; connect(); }, 3000);
  }

  /* ----------------------------------------------------- incoming MIDI */

  function isPress(m) { return m.t === "note" ? !!m.on : m.v > 0; }

  function onMessage(m) {
    const key = keyOf(m);
    if (midi.learning) { learnFrom(m, key); return; }
    const binding = midi.map[key];
    flash(key);
    if (!binding) return;

    if (binding.target.indexOf("a:") === 0) {               // action button
      if (isPress(m)) { const a = ACTION_BY_ID[binding.target]; if (a) a.run(); }
      return;
    }
    const c = BY_ID[binding.target];
    if (!c) return;
    if (m.t === "note") {                                    // button / knob push on a slider = reset it
      if (m.on) adjust(c, c.def);
      return;
    }
    const raw = m.v;
    const next = valueFrom(c, binding, key, m);
    midi.lastIn[key] = raw;
    if (next === null || next === undefined) return;
    move(c, next);
  }

  /* Work out the new slider value from a knob/fader message. */
  function valueFrom(c, binding, key, m) {
    const range = c.max - c.min;
    // While a knob keeps turning, build on the unrounded value so small steps don't get lost to rounding.
    const shown = typeof state.values[c.id] === "number" ? state.values[c.id] : c.def;
    const cur = (midi.gestureTarget === c.id && typeof midi.acc === "number") ? midi.acc : shown;
    const max = m.t === "pb" ? 16383 : 127;
    const pos = (v) => c.min + (v / max) * range;           // controller position → value
    const mode = binding.mode || "abs";

    if (mode === "rel") {
      // Endless encoders: 1–63 up, 65–127 down (sign bit), also handles 127 = −1 (two's complement)
      let step;
      if (m.v === 64 || m.v === 0) return null;
      if (m.v < 64) step = m.v;
      else if (m.v >= 120) step = m.v - 128;                // two's complement small negatives
      else step = -(m.v - 64);
      step = Math.max(-8, Math.min(8, step));
      return cur + step * range / 400;                       // ~400 steps across the full range
    }
    if (mode === "fine") {
      const prev = midi.lastIn[key] !== undefined ? midi.lastIn[key] : midi.lastOut[key];
      if (prev === undefined) return null;                   // first touch just sets the reference
      return cur + (m.v - prev) * (range / max) * FINE;
    }
    if (mode === "fader") {
      const target = pos(m.v);
      if (!midi.picked[key]) {
        const prev = midi.lastIn[key];
        const prevPos = prev === undefined ? target : pos(prev);
        const crossed = (prevPos - cur) * (target - cur) <= 0 || Math.abs(target - cur) <= range / 100;
        if (!crossed) return null;
        midi.picked[key] = true;
      }
      return target;
    }
    return pos(m.v);                                          // abs
  }

  /* Each knob movement is part of one adjustment until it rests, so Undo takes back the whole turn. */
  function move(c, value) {
    if (midi.gestureTarget !== c.id) {
      endGestureNow();
      midi.gestureTarget = c.id;
      beginGesture([c.id]);
      state.interacting = true;
    }
    midi.acc = Math.min(c.max, Math.max(c.min, value));
    commit(c, value, value);
    clearTimeout(midi.gestureTimer);
    midi.gestureTimer = setTimeout(endGestureNow, GESTURE_IDLE_MS);
  }
  function endGestureNow() {
    clearTimeout(midi.gestureTimer);
    midi.gestureTimer = null;
    if (midi.gestureTarget === null) return;
    midi.gestureTarget = null;
    midi.acc = null;
    state.interacting = false;
    endGesture();
    if (typeof flush === "function" && !flushing && Object.keys(pending).length) flush();
  }

  /* ------------------------------------------------- feedback (LED rings) */

  // Called by Tonal whenever values change (after a read, a move, undo, a new clip…)
  function sendFeedback(force) {
    if (!midi.connected) return;
    for (const key of Object.keys(midi.map)) {
      const b = midi.map[key];
      const p = parseKey(key);
      if (p.t !== "cc") continue;
      const c = BY_ID[b.target];
      if (!c || b.mode === "rel" || b.mode === "fader") continue;
      const v = state.values[c.id];
      if (typeof v !== "number") continue;
      const out = Math.max(0, Math.min(127, Math.round(((v - c.min) / (c.max - c.min)) * 127)));
      if (!force && midi.lastOut[key] === out) continue;
      // While a knob is being turned in Absolute mode, don't echo its own value back at it.
      if (!force && midi.gestureTarget === c.id && b.mode !== "fine") { midi.lastOut[key] = out; continue; }
      midi.lastOut[key] = out;
      if (b.mode === "fine") midi.lastIn[key] = out;          // next step is measured from where the ring now sits
      send({ t: "cc", dev: p.dev, ch: p.ch, n: p.n, v: out });
    }
    // a fader must catch up again after the value changed some other way
    if (force || midi.gestureTarget === null) {
      for (const key of Object.keys(midi.picked)) {
        const b = midi.map[key];
        if (!b || midi.gestureTarget !== b.target) midi.picked[key] = false;
      }
    }
  }
  let feedbackQueued = false;
  window.tonalValuesChanged = function () {
    if (feedbackQueued) return;
    feedbackQueued = true;
    setTimeout(() => { feedbackQueued = false; sendFeedback(false); }, 30);
  };

  /* --------------------------------------------------------------- learn */

  function startLearn(target) {
    if (midi.learning && midi.learning.target === target) { midi.learning = null; render(); return; }
    midi.learning = { target, until: Date.now() + LEARN_TIMEOUT_MS, samples: [], key: null };
    render();
    setTimeout(() => { if (midi.learning && Date.now() >= midi.learning.until) { midi.learning = null; render(); } }, LEARN_TIMEOUT_MS + 50);
  }

  function learnFrom(m, key) {
    const L = midi.learning;
    const isAction = L.target.indexOf("a:") === 0;
    if (m.t === "note" && !m.on) return;                    // wait for the press
    if (m.t === "cc" && isAction && m.v === 0) return;
    if (isAction || m.t === "note") { assign(key, L.target, "abs"); return; }

    // Knob or fader: watch a few messages to tell an endless encoder from a positional one.
    if (L.key && L.key !== key) return;                     // stick with the first control touched
    L.key = key;
    L.samples.push(m.v);
    if (m.t === "pb") { assign(key, L.target, "fader"); return; }
    if (L.samples.length === 1) {
      L.timer = setTimeout(() => finishLearn(), 350);
    }
    if (L.samples.length >= 4) { clearTimeout(L.timer); finishLearn(); }
  }

  function finishLearn() {
    const L = midi.learning;
    if (!L || !L.key) return;
    const s = L.samples;
    // Endless encoders repeat small step codes (1, 2, 65, 127…); positional knobs walk through values.
    const allStepCodes = s.every((v) => (v >= 1 && v <= 8) || (v >= 65 && v <= 72) || v >= 120 || (v >= 56 && v <= 63));
    const repeats = s.length > 1 && s.every((v) => v === s[0]);
    const mode = (allStepCodes && (repeats || s.length === 1 && (s[0] === 1 || s[0] === 65 || s[0] === 127))) ? "rel" : "abs";
    assign(L.key, L.target, mode);
  }

  function assign(key, target, mode) {
    // A control can have one knob/fader and one button; a MIDI control drives only one thing.
    const p = parseKey(key);
    const isButton = p.t === "note";
    for (const k of Object.keys(midi.map)) {
      if (midi.map[k].target === target && (parseKey(k).t === "note") === isButton) delete midi.map[k];
    }
    midi.map[key] = { target, mode };
    midi.lastIn[key] = undefined;
    midi.picked[key] = false;
    midi.learning = null;
    save();
    render();
    sendFeedback(true);
  }

  function clear(target) {
    bindingsFor(target).forEach((k) => { delete midi.map[k]; });
    if (midi.learning && midi.learning.target === target) midi.learning = null;
    save();
    render();
  }

  function cycleMode(key) {
    const b = midi.map[key];
    if (!b) return;
    b.mode = MODES[(MODES.indexOf(b.mode || "abs") + 1) % MODES.length];
    midi.lastIn[key] = undefined;
    midi.picked[key] = false;
    save();
    render();
    sendFeedback(true);
  }

  /* ------------------------------------------------------------------ UI */

  function e(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  const rowEls = {};   // target -> { row, binds, learn }

  function render() {
    const root = document.getElementById("tn-midi-body");
    if (!root) return;
    const st = document.getElementById("tn-midi-status");
    const btn = document.getElementById("tn-toggleMidi");
    if (midi.connected) {
      st.textContent = midi.devices.length ? "Tonal Bridge · " + midi.devices.join(", ") : "Tonal Bridge connected · no controller plugged in";
      st.className = "tn-midi-status tn-midi-ok";
    } else {
      st.textContent = "Tonal Bridge isn't running. Install it from jordanmansfield.dev/tonal, then open it.";
      st.className = "tn-midi-status";
    }
    if (btn) toggleClass(btn, "tn-midi-live", midi.connected && midi.devices.length > 0);

    root.innerHTML = "";
    const groups = [];
    CONTROLS.forEach((c) => { if (groups.indexOf(c.group) === -1) groups.push(c.group); });
    groups.forEach((g) => {
      root.appendChild(e("div", "tn-sub", g.toUpperCase()));
      CONTROLS.filter((c) => c.group === g).forEach((c) => {
        const label = (c.group === "Creative" && c.id === "csat") ? "Saturation (Creative)" : c.name;
        root.appendChild(buildMapRow(c.id, label, "Turn a knob or move a fader. Press a button to make it reset this slider."));
      });
    });
    root.appendChild(e("div", "tn-sub", "BUTTONS"));
    ACTIONS.forEach((a) => root.appendChild(buildMapRow(a.id, a.name, "Press a button on your controller.")));
  }

  function buildMapRow(target, label, learnHint) {
    const row = e("div", "tn-map-row");
    const head = e("div", "tn-map-head");
    head.appendChild(e("span", "tn-map-name", label));
    const right = e("div", "tn-map-right");
    const learning = midi.learning && midi.learning.target === target;
    const learn = e("div", "tn-btn" + (learning ? " tn-active" : ""), learning ? "Cancel" : "Learn");
    learn.addEventListener("click", () => startLearn(target));
    right.appendChild(learn);
    const keys = bindingsFor(target);
    if (keys.length) {
      const x = e("div", "tn-btn", "Clear");
      x.addEventListener("click", () => clear(target));
      right.appendChild(x);
    }
    head.appendChild(right);
    row.appendChild(head);

    const binds = e("div", "tn-map-binds");
    if (learning) {
      binds.appendChild(e("span", "tn-map-hint", midi.connected ? learnHint : "Open Tonal Bridge first."));
    } else if (!keys.length) {
      binds.appendChild(e("span", "tn-map-none", "Not assigned"));
    } else {
      keys.forEach((k) => {
        const chip = e("span", "tn-map-chip", describeKey(k) + (parseKey(k).t === "note" && target.indexOf("a:") !== 0 ? " · reset" : ""));
        chip.setAttribute("data-key", k);
        binds.appendChild(chip);
        if (parseKey(k).t !== "note" && target.indexOf("a:") !== 0) {
          const mode = midi.map[k].mode || "abs";
          const m = e("span", "tn-map-mode", MODE_LABEL[mode]);
          m.title = MODE_HELP[mode] + " (click to change)";
          m.addEventListener("click", () => cycleMode(k));
          binds.appendChild(m);
        }
      });
    }
    row.appendChild(binds);
    rowEls[target] = { row };
    return row;
  }

  // Briefly highlight the chip of whatever control just moved, so it's easy to see what's mapped where.
  function flash(key) {
    const panel = document.getElementById("tn-midi");
    if (!panel || panel.classList.contains("tn-hidden")) return;
    const chips = document.querySelectorAll(".tn-map-chip");
    for (let i = 0; i < chips.length; i++) {
      if (chips[i].getAttribute("data-key") === key) {
        const chip = chips[i];
        chip.classList.add("tn-map-flash");
        setTimeout(() => chip.classList.remove("tn-map-flash"), 180);
      }
    }
  }

  function wire() {
    const btn = document.getElementById("tn-toggleMidi");
    const panel = document.getElementById("tn-midi");
    btn.addEventListener("click", () => {
      const open = panel.classList.contains("tn-hidden");
      toggleClass(panel, "tn-hidden", !open);
      toggleClass(document.getElementById("tn-controls"), "tn-hidden", open);
      toggleClass(btn, "tn-active", open);
      if (!open) { midi.learning = null; setTimeout(paintAll, 0); }
      render();
    });
    document.getElementById("tn-midi-clearAll").addEventListener("click", () => {
      midi.map = {}; midi.learning = null; save(); render();
    });
    document.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape" && midi.learning) { midi.learning = null; render(); }
    });
  }

  load();
  wire();
  render();
  connect();
  window.tonalMidi = midi;   // for diagnostics
})();
