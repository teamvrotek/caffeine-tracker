// Pure caffeine math. No side effects, no SDK imports - easy to test.
//
// Model: exponential decay with configurable half-life.
//   Current mg at time `now` from a dose taken at time `ts` of `mg` mg:
//     residual = mg * 0.5 ^ ((now - ts) / halfLifeHours_in_ms)
//   Total current caffeine = sum of residuals across all doses.
//
// Sleep threshold estimate: solve for t when residual reaches `threshold`.
//   threshold = current * 0.5 ^ (t / halfLife)
//   t = halfLife * log2(current / threshold)

const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 24 * MS_PER_HOUR;
const HISTORY_DAYS = 7;
// Older doses remain available to the model while their residual is at least
// this amount. Recent history is retained separately from residual caffeine.
const MIN_RESIDUAL_MG = 0.5;

function finiteNumber(value) {
    const n = typeof value === "number" || (typeof value === "string" && value.trim() !== "") ? Number(value) : NaN;
    return Number.isFinite(n) ? n : NaN;
}

function positiveNumber(value, fallback = 0) {
    const n = finiteNumber(value);
    return Number.isFinite(n) && n > 0 ? n : fallback;
}

// Sum the exponential-decay residuals of every dose.
export function currentCaffeine(doses, halfLifeHours, now = Date.now()) {
    if (!Array.isArray(doses) || doses.length === 0) return 0;
    let total = 0;
    for (const dose of doses) {
        total += residualFor(dose, halfLifeHours, now);
    }
    return total;
}

// Returns the Date when current caffeine will drop below `thresholdMg`.
// Returns null if already at/below threshold.
export function safeAt(currentMg, thresholdMg, halfLifeHours, now = Date.now()) {
    const current = positiveNumber(currentMg);
    const threshold = positiveNumber(thresholdMg, 50);
    const h = positiveNumber(halfLifeHours, 5);
    if (current <= threshold) return null;
    const hoursUntilThreshold = h * Math.log2(current / threshold);
    return new Date(now + hoursUntilThreshold * MS_PER_HOUR);
}

// Format a Date as "HH:MM" in the local timezone (24h clock).
export function formatClock(date) {
    if (!(date instanceof Date) || !Number.isFinite(date.getTime())) return null;
    const hh = String(date.getHours()).padStart(2, "0");
    const mm = String(date.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
}

// Compact local sleep estimate. Calendar offsets remain correct across DST.
// Examples: "23:00", "11:00p", "01:15 +1d", "1:15a +1d".
export function formatEstimate(date, timeFormat = "24", now = Date.now()) {
    const clock = formatClock(date);
    if (clock === null) return null;
    const reference = new Date(now);
    if (!Number.isFinite(reference.getTime())) return null;
    let formatted = clock;
    if (String(timeFormat) === "12") {
        const hour = date.getHours();
        const minute = String(date.getMinutes()).padStart(2, "0");
        formatted = `${hour % 12 || 12}:${minute}${hour < 12 ? "a" : "p"}`;
    }
    const dateDay = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
    const referenceDay = Date.UTC(reference.getFullYear(), reference.getMonth(), reference.getDate());
    const daysLater = Math.round((dateDay - referenceDay) / MS_PER_DAY);
    return daysLater > 0 ? `${formatted} +${daysLater}d` : formatted;
}

// Project the current estimate to the next occurrence of a local bedtime.
// setDate preserves the requested wall-clock time when crossing a DST change.
export function caffeineAtBedtime(currentMg, bedtime = "23:00", halfLifeHours = 5, now = Date.now()) {
    const current = positiveNumber(currentMg);
    const h = positiveNumber(halfLifeHours, 5);
    const target = new Date(now);
    if (!Number.isFinite(target.getTime())) return 0;
    const match = typeof bedtime === "string" && /^([01]\d|2[0-3]):([0-5]\d)$/.exec(bedtime);
    const hour = match ? Number(match[1]) : 23;
    const minute = match ? Number(match[2]) : 0;
    target.setHours(hour, minute, 0, 0);
    if (target.getTime() < now) {
        target.setDate(target.getDate() + 1);
        target.setHours(hour, minute, 0, 0);
    }
    const hoursUntilBedtime = (target.getTime() - now) / MS_PER_HOUR;
    return current * Math.pow(0.5, hoursUntilBedtime / h);
}

// Count saved entries for a drink label today, using the local calendar day.
// Each entry counts once, independently of serving quantity, artwork or dose.
export function countTodayForLabel(doses, label, now = Date.now()) {
    if (!Array.isArray(doses) || doses.length === 0 || typeof label !== "string") return 0;
    const target = label.trim().toLowerCase();
    const currentTime = finiteNumber(now);
    const today = new Date(currentTime);
    if (!target || !Number.isFinite(today.getTime())) return 0;
    today.setHours(0, 0, 0, 0);
    const midnight = today.getTime();
    let n = 0;
    for (const d of doses) {
        if (!d || typeof d.label !== "string") continue;
        if (d.label.trim().toLowerCase() !== target) continue;
        const ts = finiteNumber(d.ts);
        if (!Number.isFinite(ts) || ts <= 0 || ts < midnight || ts > currentTime) continue;
        n++;
    }
    return n;
}

// Classify estimated caffeine remaining into visual intensity bands.
// Legacy zone names are retained for compatibility. These are display bands,
// not medical safety categories or recommended daily consumption limits.
export function zoneFor(mg) {
    if (mg < 1) return "empty";
    if (mg < 100) return "safe";
    if (mg < 200) return "fine";
    if (mg < 400) return "high";
    return "over";
}

// Keep history from local midnight seven days ago, independently of residual.
// Older doses remain while their residual is at least MIN_RESIDUAL_MG (0.5 mg).
// Caffeine-free drinks remain in recent history. Negative, malformed and
// future-timestamped doses are dropped.
export function pruneDoses(doses, halfLifeHours, now = Date.now()) {
    if (!Array.isArray(doses)) return [];
    const oldestHistory = new Date(now);
    oldestHistory.setHours(0, 0, 0, 0);
    oldestHistory.setDate(oldestHistory.getDate() - HISTORY_DAYS);
    return doses.filter(dose => {
        if (!dose || typeof dose !== "object") return false;
        const mg = finiteNumber(dose.mg);
        const ts = positiveNumber(dose.ts);
        if (!Number.isFinite(mg) || mg < 0 || ts <= 0 || ts > now) return false;
        return ts >= oldestHistory.getTime() || residualFor(dose, halfLifeHours, now) >= MIN_RESIDUAL_MG;
    });
}

// Compute the residual mg of a single dose at `now`. Used by the PI to show
// the live decayed mg next to each dose row.
export function residualFor(dose, halfLifeHours, now = Date.now()) {
    if (!dose || typeof dose !== "object") return 0;
    const mg = positiveNumber(dose.mg);
    const ts = positiveNumber(dose.ts);
    if (mg <= 0 || ts <= 0 || ts > now) return 0;
    const h = positiveNumber(halfLifeHours, 5);
    const elapsedHours = (now - ts) / MS_PER_HOUR;
    return mg * Math.pow(0.5, elapsedHours / h);
}
