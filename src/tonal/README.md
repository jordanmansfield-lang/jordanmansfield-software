# Tonal: Lumetri sliders for Premiere Pro

A docked panel with proper sliders for the classic **Lumetri Color** effect. It edits the Lumetri Color effect already on your clips, so Premiere's own Lumetri engine still does the grading. The panel only gives you a better way to set the numbers.

Download page: https://jordanmansfield.dev/tonal

## Install

1. Quit Premiere Pro.
2. Double-click `Tonal-x.y.z.ccx`. Creative Cloud opens and asks you to confirm. It warns you to only install plugins from sources you trust.
3. Open Premiere and choose **Window → UXP Plugins → Tonal**, then dock the panel wherever suits you.

Needs Premiere Pro 25.6 or later and the Creative Cloud desktop app.

## Updates

When a new version is out, a notice appears at the top of the panel. Click **Download**, then double-click the new file. It replaces the old version. Your settings and grades aren't affected, because they live in your Premiere projects. Click **Later** to hide the notice until the next version comes out.

## Use

- Select one or more clips on the timeline. The sliders read the first clip and write to every selected clip.
- If a clip doesn't have Lumetri Color yet, the panel adds it the first time you move a slider.
- **Drag** to adjust. **Shift-drag** for fine control. **Double-click** a slider or its name to reset it. **Click the number** to type a value.
- The small dot beside a value means it has been changed from its default. Click the dot to reset.
- **Keyframes** work like Effect Controls. The diamond (◇) beside a value starts keyframing that setting, with a keyframe at the playhead. Once a setting is keyframed, moving its slider sets a keyframe at the playhead (or updates the one already there), and the slider shows the value wherever the playhead sits. A filled diamond (◆) means there's a keyframe at the playhead; click it to remove that keyframe. Keyframed sliders pause while the playhead is off the clip. To switch keyframing off completely, which deletes all of that setting's keyframes, use the stopwatch in Effect Controls.
- **Undo:** use Tonal's **Undo** button, or Cmd+Z (Ctrl+Z on Windows) while the panel is focused. It undoes a whole adjustment in one go (a full drag, a typed number, a reset, or a keyframe added or removed), keyframes included and puts every selected clip back to its own previous value. Shift+Cmd+Z redoes. Tonal forgets its history when you select different clips.
- **Live** (on by default): the picture updates while you drag. Because Premiere can't group changes, a live drag leaves several small steps in Premiere's own undo history, which is why Tonal has its own Undo. Turn Live off to send one change when you let go, so Premiere's Edit → Undo works normally too.

## MIDI controllers (Behringer X-Touch Mini and others)

Premiere plugins can't read MIDI devices, so a small companion app, **Tonal Bridge**, does it. It sits in the menu bar, reads every MIDI controller plugged into the Mac, and passes knob, fader and button messages to Tonal over a connection that never leaves the computer.

1. Download Tonal Bridge from https://jordanmansfield.dev/tonal, unzip it and drag it into Applications.
2. The first time, right-click it and choose **Open**, because it isn't from the App Store. On newer macOS versions you may need System Settings → Privacy & Security → **Open Anyway**. Use its menu-bar icon to turn on **Open at Login**.
3. In Tonal, click **MIDI**. The top line should show your controller's name.
4. Click **Learn** beside a slider, then turn a knob or move a fader. To make a button (or a knob push) reset that slider, click Learn again and press it.
5. Under **Buttons**, map Undo, Redo, Reset all, Live on/off, and two actions for the last slider you touched: reset it, or add or remove its keyframe at the playhead.

Each knob mapping has a mode. Click the chip to change it:
- **ABS** – the knob's position sets the value. LED rings follow your grade when you change clips or undo.
- **FINE** – like ABS, but each step moves a quarter as far. Good for Temperature and Tint.
- **REL** – for endless encoders that send "up" and "down" steps (for example, the X-Touch Mini in MC mode).
- **FADER** – for faders without motors. A fader only takes over once you move it past the current value, so nothing jumps.

Tonal guesses the right mode when you learn a control. A whole knob turn is one step in Tonal's undo. Mappings are saved with the panel.

## If something doesn't line up

Click **i** at the top of the panel. It lists every Lumetri parameter on the selected clip, with its value and which slider it's linked to.

---

## Releasing a new version (for Jordan)

1. Make the changes, then bump `version` in `manifest.json` **and** `BUILT_IN_VERSION` in `main.js`.
2. Package it: in UXP Developer Tool choose **••• → Package**, or zip `manifest.json`, `index.html`, `main.js`, `styles.css` and `icons/` into `Tonal-x.y.z.ccx`.
3. In the website repo, put the `.ccx` in `public/downloads/tonal/`, then update `TONAL` (version and summary) in `build.py` and run `python3 build.py`. This rewrites `version.json` and the download page.
4. Commit and push. Once Cloudflare deploys, every open copy of Tonal shows the update notice within a few hours, and straight away the next time Premiere opens.
