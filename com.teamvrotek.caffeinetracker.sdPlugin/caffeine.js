// Pure caffeine math. No side effects, no SDK imports - easy to test.
//
// Model: exponential decay with configurable half-life.
//   Current mg at time `now` from a dose taken at time `ts` of `mg` mg:
//     residual = mg * 0.5 ^ ((now - ts) / halfLifeHours_in_ms)
//   Total current caffeine = sum of residuals across all doses.
//
// Safe-to-sleep time: we solve for t when residual drops below `threshold`.
//   threshold = current * 0.5 ^ (t / halfLife)
//   t = halfLife * log2(current / threshold)

const MS_PER_HOUR = 3_600_000;
// Any dose whose decayed residual falls below this is effectively gone.
// For a 95mg dose at 5h half-life, this takes ~38h. For a 400mg pre-workout
// it takes ~48h. Bigger doses hang on longer, which is the whole point.
const MIN_RESIDUAL_MG = 0.5;

// Sum the exponential-decay residuals of every dose.
export function currentCaffeine(doses, halfLifeHours, now = Date.now()) {
    if (!Array.isArray(doses) || doses.length === 0) return 0;
    const h = Number(halfLifeHours) || 5;
    let total = 0;
    for (const dose of doses) {
        const mg = Number(dose.mg) || 0;
        const ts = Number(dose.ts) || 0;
        if (mg <= 0 || ts <= 0 || ts > now) continue;
        const elapsedHours = (now - ts) / MS_PER_HOUR;
        total += mg * Math.pow(0.5, elapsedHours / h);
    }
    return total;
}

// Returns the Date when current caffeine will drop below `thresholdMg`.
// Returns null if already at/below threshold.
export function safeAt(currentMg, thresholdMg, halfLifeHours, now = Date.now()) {
    const current = Number(currentMg) || 0;
    const threshold = Number(thresholdMg) || 50;
    const h = Number(halfLifeHours) || 5;
    if (current <= threshold) return null;
    const hoursUntilSafe = h * Math.log2(current / threshold);
    return new Date(now + hoursUntilSafe * MS_PER_HOUR);
}

// Format a Date as "HH:MM" in the local timezone (24h clock).
export function formatClock(date) {
    if (!date) return null;
    const hh = String(date.getHours()).padStart(2, "0");
    const mm = String(date.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
}

// Count today's doses that match a given drink label (calendar-day, local time).
// Used for the "×N" per-button counter. Resets at local midnight automatically.
export function countTodayForLabel(doses, label, now = Date.now()) {
    if (!Array.isArray(doses) || doses.length === 0 || !label) return 0;
    const today = new Date(now).toDateString();
    const target = String(label).toLowerCase();
    let n = 0;
    for (const d of doses) {
        if (!d || typeof d.label !== "string") continue;
        if (d.label.toLowerCase() !== target) continue;
        if (new Date(d.ts).toDateString() !== today) continue;
        n++;
    }
    return n;
}

// Classify current caffeine into a color zone.
// Thresholds tuned to FDA 400mg/day daily max and common sleep-impact levels.
export function zoneFor(mg) {
    if (mg < 1) return "empty";
    if (mg < 100) return "safe";
    if (mg < 200) return "fine";
    if (mg < 400) return "high";
    return "over";
}

// Drop doses whose decayed residual has fallen below MIN_RESIDUAL_MG (0.5 mg).
// No hard time cap - a big dose from 40h ago might still be hanging on above
// the threshold and will stay in the log until it genuinely decays out.
// Negative / zero / future-timestamped doses are also dropped (sanity).
export function pruneDoses(doses, halfLifeHours, now = Date.now()) {
    if (!Array.isArray(doses)) return [];
    const h = Number(halfLifeHours) || 5;
    return doses.filter(dose => {
        const mg = Number(dose.mg) || 0;
        const ts = Number(dose.ts) || 0;
        if (mg <= 0 || ts <= 0 || ts > now) return false;
        const elapsedHours = (now - ts) / MS_PER_HOUR;
        const residual = mg * Math.pow(0.5, elapsedHours / h);
        return residual >= MIN_RESIDUAL_MG;
    });
}

// Compute the residual mg of a single dose at `now`. Used by the PI to show
// the live decayed mg next to each dose row.
export function residualFor(dose, halfLifeHours, now = Date.now()) {
    if (!dose) return 0;
    const mg = Number(dose.mg) || 0;
    const ts = Number(dose.ts) || 0;
    if (mg <= 0 || ts <= 0 || ts > now) return 0;
    const h = Number(halfLifeHours) || 5;
    const elapsedHours = (now - ts) / MS_PER_HOUR;
    return mg * Math.pow(0.5, elapsedHours / h);
}
