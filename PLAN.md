# Caffeine Tracker - Stream Deck Plugin

A multi-button caffeine half-life tracker for Elgato Stream Deck. Each button logs
one kind of drink (coffee, energy, cola, anything). All buttons share a global
readout: total caffeine in system + clock time when it's safe to sleep.

Design sketched at: [Caffeine Tracker Mockups](https://dev.dirigato.com/mindmap/UPyaF5F2EDXc)

- **UUID**: `com.teamvrotek.caffeinetracker`
- **Name**: Caffeine Tracker
- **Base**: forked structure from `claude-peak-streamdeck-ticker`
- **SDK**: Elgato Stream Deck SDK v3, Node.js 20
- **Status**: planning / greenfield

---

## Button face (what every drink button shows)

```
┌─────────────┐
│   COFFEE    │   per-button label (set in PI)
│             │
│     235     │   SHARED: total current mg, colored by zone
│     mg      │
│  bed 01:10  │   SHARED: safe-to-sleep clock (or "✓" when safe)
└─────────────┘
```

Every button placed on the Stream Deck shows the **same** current mg and same
safe-sleep time. The label + dose are the only things that differ per button.
Press any button to log one dose of that drink. Long-press any button to undo
the most recent dose globally.

### Color zones (driven by current total mg)

| Range | Zone | Border / Number |
| --- | --- | --- |
| 0 mg | empty | slate |
| 1-99 | safe | green (`#4ade80`) |
| 100-199 | fine | yellow (`#fde047`) |
| 200-399 | high | orange (`#fb923c`) |
| 400+ | over | red (`#ef4444`) (FDA daily max) |

### Safe-sleep clock format

- When `current_mg > threshold_mg`: show `bed HH:MM` (24h clock, when total will drop below threshold)
- When `current_mg <= threshold_mg`: show `✓` (already safe to sleep)

---

## The math

```
current_mg  =  Σ  dose.mg × 0.5 ^ ( (now - dose.ts) / halfLifeHours )

t_safe_hours  =  halfLifeHours × log₂( current_mg / threshold_mg )
safe_at       =  now + t_safe_hours
```

### Defaults (configurable in PI)

- `halfLifeHours`: **5** (range 3-8, matches HalfCup's range, covers typical CYP1A2 variation)
- `thresholdMg`: **50** (common "won't disrupt sleep" level; range 25-100)
- `bedtimeHour`: **23** (optional, only used for border pulse warning)

---

## Interactions

| Gesture | Action |
| --- | --- |
| **Short press** (< 800ms) | Log one dose of this button's drink. Total jumps, all buttons re-render. |
| **Long press** (≥ 800ms) | Undo most recent dose (any drink, globally). Button flashes. |

Optional ambient cue (v2):
- **Border pulse** when `current_mg > thresholdMg` AND `now` is within 3h of `bedtimeHour`

---

## File layout

```
caffeine-tracker/
├── PLAN.md                              ← this doc
├── README.md
├── LICENSE
├── build.sh                             ← zips the .sdPlugin for Stream Deck
├── com.teamvrotek.caffeinetracker.sdPlugin/
│   ├── manifest.json                    ← plugin metadata + 1 action
│   ├── plugin.js                        ← main plugin entry, SingletonAction
│   ├── renderer.js                      ← canvas button-face rendering
│   ├── caffeine.js                      ← pure decay + safe-time math
│   ├── package.json                     ← deps (@elgato/streamdeck, canvas)
│   ├── imgs/
│   │   ├── pluginIcon.png
│   │   ├── categoryIcon.png
│   │   ├── actionIcon.png
│   │   └── actionDefaultImage.png
│   └── ui/
│       ├── property-inspector.html      ← per-button + global config
│       └── property-inspector.js
├── previews/                            ← screenshots for marketplace
└── Release/                             ← built .streamDeckPlugin packages
```

---

## State model

### Global settings (shared across all buttons)
`streamDeck.settings.setGlobalSettings(...)` persists between launches.

```js
{
  doses: [
    { id: "uuid", mg: 95, label: "Coffee", ts: 1713345600000 },
    { id: "uuid", mg: 150, label: "Energy", ts: 1713356000000 }
  ],
  halfLifeHours: 5,
  thresholdMg: 50,
}
```

Doses older than 24h are pruned on each tick (residual below 1% of threshold, negligible).

### Per-button settings (unique per Stream Deck key placement)
`action.setSettings(...)` per-context.

```js
{
  label: "Coffee",      // displayed on the face
  dose: 95,             // mg logged per press
  icon: "☕"             // optional emoji (v2)
}
```

---

## Property inspector (PI)

Two sections:

**Per-button (this button)**
- Drink label (text)
- Dose in mg (number, typical: espresso 64, drip 95, cold brew 200, energy 150, cola 35)
- Icon / emoji (v2)

**Global settings (affects all buttons)**
- Half-life hours (slider 3-8, default 5)
- Sleep threshold mg (slider 25-100, default 50)
- "Clear all doses" button (reset for testing)

---

## Tick loop

Every 60 seconds:
1. Prune doses older than 24h
2. Compute `currentMg` from remaining doses
3. Compute `safeAt` clock time
4. Determine zone color
5. Re-render every visible button with new values

Plus immediate re-render on:
- Any keyDown (log a dose, then refresh)
- Any long-press-undo
- PI changes (half-life, threshold)

---

## Build phases

Keep each phase small so we can test at every checkpoint.

### Phase 1 — Scaffold (~1h)
- [ ] Copy structure from `claude-peak-streamdeck-ticker`
- [ ] Update `manifest.json`: new UUID, name, one action `com.teamvrotek.caffeinetracker.drink`
- [ ] Bare `plugin.js` that just logs keyDown to console
- [ ] Bare `renderer.js` that renders placeholder "CAFFEINE / 0 / mg / ✓"
- [ ] Install deps (`@elgato/streamdeck`, `canvas`)
- [ ] `build.sh` produces installable `.streamDeckPlugin`
- **Test**: install plugin, drop button on Stream Deck, see placeholder render.

### Phase 2 — Core math (~1-2h)
- [ ] `caffeine.js` with `currentCaffeine(doses, halfLife)`, `safeAtClock(mg, threshold, halfLife)`, `zoneFor(mg)`
- [ ] Sanity tests in a `caffeine.test.js` (node built-in test runner)
- [ ] Wire global settings: `initGlobalSettings()`, `addDose(mg, label)`, `undoLastDose()`
- **Test**: run tests. Verify 235mg at 5h half-life returns expected safe-time.

### Phase 3 — Logging (~1h)
- [ ] `willAppear`: register context, render
- [ ] `keyDown`: start hold timer
- [ ] `keyUp`: short press → `addDose(settings.dose, settings.label)`; long press → `undoLastDose()`
- [ ] Refresh all visible buttons on any change
- **Test**: press a button with default dose, see number climb. Long-press, see it drop.

### Phase 4 — Rendering (~2h)
- [ ] Canvas 4-layer render (label / number / mg / safe-time)
- [ ] Color by zone (border, number color)
- [ ] `✓` when below threshold
- [ ] Font sizing tuned for 72x72 physical button
- **Test**: press button on real Stream Deck hardware, verify legibility at arm's length.

### Phase 5 — Property inspector (~2h)
- [ ] `ui/property-inspector.html` + `.js`
- [ ] Per-button: label + dose mg inputs
- [ ] Global: half-life slider, threshold slider, bedtime hour
- [ ] "Clear all doses" button for testing
- [ ] Wire `sendToPlugin` / `didReceiveSettings`
- **Test**: change settings in PI, see button update live.

### Phase 6 — Tick loop + polish (~1h)
- [ ] 60s tick to recompute + re-render
- [ ] Prune old doses
- [ ] Undo flash animation
- [ ] Handle 0-dose state cleanly
- **Test**: log a dose, wait 5+ minutes, verify decay shows.

### Phase 7 — Icon art + README (~1h)
- [ ] Plugin icon, category icon, action icon, default button image
- [ ] README with install + usage
- **Test**: all icons render correctly in Stream Deck software.

**Total estimate: 8-10h, spread over 1-2 sessions.**

---

## Open questions (locked unless we revisit)

- [x] Multi-button (one action, many placements) — confirmed
- [x] Shared total + safe-time, per-button label only — confirmed
- [x] Long-press undo on any button — confirmed
- [x] Color zones: 100 / 200 / 400 — confirmed
- [x] Safe-time format: `bed HH:MM` absolute clock — recommend (actionable vs relative)
- [x] Pulse border near bedtime — dropped from scope (bedtime field removed)
- [ ] External JSON log of all doses for stats/graphs — defer to v2, optional opt-in
- [ ] Drink icon / emoji on face — defer to v2, keep v1 text-only

---

## Out of scope for v1 (v2+ ideas)

- Decay sparkline graph on the face (too cramped on 72x72)
- Daily / weekly / monthly stats view (would need a separate view, e.g. PI popup)
- HealthKit sync (Stream Deck is desktop-only, no Apple integration; could export a JSON that HealthKit imports)
- Per-drink count / last-pressed display on face (state is tracked but not shown; surface in PI stats tab)
- Sipping duration model (Caffeine Clock has this; probably overkill for a button)
- Voice logging via Siri / global hotkeys
- Stream Deck + dial support (scrub timeline)

---

## Research references

Apple Watch / iOS apps studied (from mindmap section 8 research):

- **Apple's own Coffee Tracker sample** — canonical 5h half-life model, 24h window, 3 complication types
- **HalfCup** — real-time decay curve, "sleep-ready by" time text, 2-10h half-life range
- **HiCoffee** — metabolism graph, bedtime planning, sensitivity-based personal limits
- **Caffeine Clock** (web) — long-press timeline scrubbing to preview future levels
- **RECaf** — Siri shortcuts for one-tap logging
