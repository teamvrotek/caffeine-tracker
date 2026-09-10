// Sanity tests for the caffeine math. Run with: node --test caffeine.test.js
// Uses Node's built-in test runner (no deps).

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
    currentCaffeine,
    safeAt,
    formatClock,
    formatEstimate,
    caffeineAtBedtime,
    zoneFor,
    pruneDoses,
    countTodayForLabel,
    residualFor,
} from "./caffeine.js";

const HOUR = 3_600_000;

test("currentCaffeine: no doses returns 0", () => {
    assert.equal(currentCaffeine([], 5), 0);
    assert.equal(currentCaffeine(null, 5), 0);
    assert.equal(currentCaffeine(undefined, 5), 0);
});

test("currentCaffeine: single dose at t=0 returns full mg", () => {
    const now = 1_000_000_000_000;
    const result = currentCaffeine([{ mg: 95, ts: now }], 5, now);
    assert.equal(result, 95);
});

test("currentCaffeine: one half-life halves the dose", () => {
    const now = 1_000_000_000_000;
    const ts = now - 5 * HOUR;
    const result = currentCaffeine([{ mg: 100, ts }], 5, now);
    assert.ok(Math.abs(result - 50) < 0.01, `expected ~50, got ${result}`);
});

test("currentCaffeine: two half-lives quarters the dose", () => {
    const now = 1_000_000_000_000;
    const ts = now - 10 * HOUR;
    const result = currentCaffeine([{ mg: 100, ts }], 5, now);
    assert.ok(Math.abs(result - 25) < 0.01, `expected ~25, got ${result}`);
});

test("currentCaffeine: multiple doses sum correctly", () => {
    const now = 1_000_000_000_000;
    // Two espressos 1h apart, 64mg each, 5h half-life
    const doses = [
        { mg: 64, ts: now - 2 * HOUR },
        { mg: 64, ts: now - 1 * HOUR },
    ];
    const result = currentCaffeine(doses, 5, now);
    // First dose: 64 * 0.5^(2/5) = 64 * 0.758 = ~48.5
    // Second dose: 64 * 0.5^(1/5) = 64 * 0.871 = ~55.7
    // Sum ~ 104.2
    assert.ok(result > 100 && result < 108, `expected ~104, got ${result}`);
});

test("currentCaffeine: ignores future doses (clock skew protection)", () => {
    const now = 1_000_000_000_000;
    const result = currentCaffeine([{ mg: 95, ts: now + HOUR }], 5, now);
    assert.equal(result, 0);
});

test("safeAt: returns null when already below threshold", () => {
    const now = 1_000_000_000_000;
    assert.equal(safeAt(40, 50, 5, now), null);
    assert.equal(safeAt(0, 50, 5, now), null);
    assert.equal(safeAt(50, 50, 5, now), null);
});

test("safeAt: 235mg at threshold 50mg half-life 5h yields ~11.2h", () => {
    const now = 1_000_000_000_000;
    const result = safeAt(235, 50, 5, now);
    const hoursUntil = (result.getTime() - now) / HOUR;
    assert.ok(Math.abs(hoursUntil - 11.2) < 0.1, `expected ~11.2h, got ${hoursUntil}`);
});

test("safeAt: double the current mg adds one half-life", () => {
    const now = 1_000_000_000_000;
    const a = safeAt(100, 50, 5, now); // one half-life = 5h
    const b = safeAt(200, 50, 5, now); // two half-lives = 10h
    const hoursA = (a.getTime() - now) / HOUR;
    const hoursB = (b.getTime() - now) / HOUR;
    assert.ok(Math.abs(hoursA - 5) < 0.01);
    assert.ok(Math.abs(hoursB - 10) < 0.01);
});

test("formatClock: pads single digits", () => {
    const d = new Date(2026, 3, 17, 1, 5);
    assert.equal(formatClock(d), "01:05");
});

test("formatClock: null input returns null", () => {
    assert.equal(formatClock(null), null);
});

test("zoneFor: boundaries", () => {
    assert.equal(zoneFor(0), "empty");
    assert.equal(zoneFor(0.5), "empty");
    assert.equal(zoneFor(1), "safe");
    assert.equal(zoneFor(99), "safe");
    assert.equal(zoneFor(100), "fine");
    assert.equal(zoneFor(199), "fine");
    assert.equal(zoneFor(200), "high");
    assert.equal(zoneFor(399), "high");
    assert.equal(zoneFor(400), "over");
    assert.equal(zoneFor(1000), "over");
});

test("pruneDoses: keeps old doses when residual still >= 0.5mg", () => {
    const now = 1_000_000_000_000;
    // 95mg at 25h with 5h half-life = 95 * 0.5^5 = 2.97mg (still above threshold)
    const doses = [
        { mg: 95, ts: now - 25 * HOUR },
    ];
    const result = pruneDoses(doses, 5, now);
    assert.equal(result.length, 1, "dose at 25h should still be present (residual ~2.97mg)");
});

test("pruneDoses: retains recent history whose residual is below 0.5mg", () => {
    const now = 1_000_000_000_000;
    // A small dose remains in recent history after decaying below 0.5mg.
    const doses = [
        { mg: 5, ts: now - 20 * HOUR }, // residual ~ 5 * 0.5^4 = 0.31mg
    ];
    const result = pruneDoses(doses, 5, now);
    assert.equal(result.length, 1);
});

test("pruneDoses: retains a 95mg dose after 40h for history", () => {
    const now = 1_000_000_000_000;
    // 95 * 0.5^(40/5) = 95 * 0.0039 = 0.37mg (below threshold)
    const doses = [
        { mg: 95, ts: now - 40 * HOUR },
    ];
    const result = pruneDoses(doses, 5, now);
    assert.equal(result.length, 1);
});

test("pruneDoses: keeps fresh doses", () => {
    const now = 1_000_000_000_000;
    const doses = [
        { mg: 95, ts: now - 30 * 60_000 }, // 30 minutes ago
    ];
    const result = pruneDoses(doses, 5, now);
    assert.equal(result.length, 1);
});

test("pruneDoses: drops doses with future timestamps (clock skew)", () => {
    const now = 1_000_000_000_000;
    const doses = [{ mg: 95, ts: now + HOUR }];
    assert.equal(pruneDoses(doses, 5, now).length, 0);
});

test("residualFor: matches the decay formula", () => {
    const now = 1_000_000_000_000;
    const dose = { mg: 100, ts: now - 5 * HOUR };
    const r = residualFor(dose, 5, now);
    assert.ok(Math.abs(r - 50) < 0.01, `expected ~50, got ${r}`);
});

test("residualFor: returns 0 for invalid dose", () => {
    const now = 1_000_000_000_000;
    assert.equal(residualFor(null, 5, now), 0);
    assert.equal(residualFor({ mg: 0, ts: now }, 5, now), 0);
    assert.equal(residualFor({ mg: 100, ts: now + 100 }, 5, now), 0);
});

test("countTodayForLabel: counts matching label from today only", () => {
    const now = new Date("2026-04-17T14:00:00").getTime();
    const doses = [
        { label: "Coffee", ts: new Date("2026-04-17T08:00:00").getTime() },
        { label: "Coffee", ts: new Date("2026-04-17T11:00:00").getTime() },
        { label: "Coffee", ts: new Date("2026-04-16T22:00:00").getTime() },
        { label: "Energy", ts: new Date("2026-04-17T09:00:00").getTime() },
    ];
    assert.equal(countTodayForLabel(doses, "Coffee", now), 2);
    assert.equal(countTodayForLabel(doses, "Energy", now), 1);
    assert.equal(countTodayForLabel(doses, "Cola", now), 0);
});

test("countTodayForLabel: trims labels and matches case-insensitively", () => {
    const now = new Date("2026-04-17T14:00:00").getTime();
    const doses = [
        { label: " coffee ", ts: new Date("2026-04-17T08:00:00").getTime() },
        { label: "COFFEE", ts: new Date("2026-04-17T11:00:00").getTime() },
    ];
    assert.equal(countTodayForLabel(doses, " Coffee ", now), 2);
});

test("countTodayForLabel: empty / bad input", () => {
    assert.equal(countTodayForLabel([], "Coffee"), 0);
    assert.equal(countTodayForLabel(null, "Coffee"), 0);
    assert.equal(countTodayForLabel([{ label: "Coffee", ts: Date.now() }], ""), 0);
});

test("countTodayForLabel: malformed and future timestamps cannot inflate the count", () => {
    const now = new Date(2026, 8, 9, 18).getTime();
    const doses = [
        null, undefined, "Coffee", {},
        { label: "Coffee", ts: now + 1 },
        { label: "Coffee", ts: NaN },
        { label: "Coffee", ts: Infinity },
        { label: "Coffee", ts: "not a date" },
        { label: "Coffee", ts: Symbol("invalid") },
        { label: "Coffee", ts: -1 },
        { label: "Coffee", ts: null },
        { label: "Coffee", ts: String(now) },
    ];
    assert.equal(countTodayForLabel(doses, "Coffee", now), 1);
    for (const invalidNow of [NaN, Infinity, "invalid", Symbol("invalid"), null, 9e15]) {
        assert.equal(countTodayForLabel(doses, "Coffee", invalidNow), 0);
    }
    assert.equal(countTodayForLabel(doses, " ", now), 0);
    assert.equal(countTodayForLabel(doses, null, now), 0);
});

test("countTodayForLabel: counts entries once rather than serving quantity or caffeine", () => {
    const now = new Date(2026, 8, 9, 18).getTime();
    const doses = [
        { label: "Coffee", mg: 95, quantity: 1, icon: "coffee", ts: now },
        { label: "Coffee", mg: 190, quantity: 2, icon: "cola", ts: now },
        { label: "Coke Zero-Zero", mg: 0, quantity: 2, icon: "coffee", ts: now },
    ];
    assert.equal(countTodayForLabel(doses, "Coffee", now), 2);
    assert.equal(countTodayForLabel(doses, "Coke Zero-Zero", now), 1);
});

test("caffeine math: malformed doses are ignored without throwing", () => {
    const now = new Date(2026, 8, 9, 12).getTime();
    const invalid = [
        null, undefined, false, "coffee", 95, [],
        { mg: Infinity, ts: now },
        { mg: NaN, ts: now },
        { mg: Symbol("invalid"), ts: now },
        { mg: 95, ts: Infinity },
        { mg: 95, ts: Symbol("invalid") },
        { mg: -95, ts: now },
        { mg: 95, ts: -1 },
    ];
    assert.equal(currentCaffeine(invalid, 5, now), 0);
    assert.deepEqual(pruneDoses(invalid, 5, now), []);
    for (const dose of invalid) assert.equal(residualFor(dose, 5, now), 0);
    assert.equal(currentCaffeine([...invalid, { mg: "95", ts: String(now) }], 5, now), 95);
});

test("caffeine math: invalid half-lives fall back to five hours", () => {
    const now = new Date(2026, 8, 9, 12).getTime();
    const dose = { mg: 100, ts: now - 5 * HOUR };
    for (const h of [0, -5, Infinity, NaN, Symbol("invalid")]) {
        assert.equal(currentCaffeine([dose], h, now), 50);
        assert.equal(safeAt(100, 50, h, now).getTime(), now + 5 * HOUR);
    }
});

test("pruneDoses: today's low-dose drink count does not disappear with decay", () => {
    const now = new Date(2026, 8, 9, 22).getTime();
    const doses = [{ mg: 1, label: "Tea", ts: new Date(2026, 8, 9, 8).getTime() }];
    assert.ok(currentCaffeine(doses, 5, now) < 0.5);
    const retained = pruneDoses(doses, 5, now);
    assert.equal(retained.length, 1);
    assert.equal(countTodayForLabel(retained, "Tea", now), 1);
});

test("pruneDoses: caffeine-free drinks remain in recent history with zero residual", () => {
    const now = new Date(2026, 8, 9, 22).getTime();
    const today = { mg: 0, label: "Coke Zero-Zero", ts: new Date(2026, 8, 9, 8).getTime() };
    const older = { mg: 0, label: "Coke Zero-Zero", ts: new Date(2026, 7, 30, 8).getTime() };
    const retained = pruneDoses([today, older], 5, now);
    assert.deepEqual(retained, [today]);
    assert.equal(countTodayForLabel(retained, "Coke Zero-Zero", now), 1);
    assert.equal(currentCaffeine(retained, 5, now), 0);
    assert.equal(residualFor(today, 5, now), 0);
    assert.deepEqual(pruneDoses([{ mg: "", ts: now }, { mg: null, ts: now }], 5, now), []);
});

test("pruneDoses: history retention starts at local midnight seven days ago", () => {
    const now = new Date(2026, 8, 9, 22).getTime();
    const cutoff = new Date(2026, 8, 2).getTime();
    const old = { mg: 1, ts: cutoff - 1 };
    const retained = { mg: 1, ts: cutoff };
    assert.deepEqual(pruneDoses([old, retained], 5, now), [retained]);
});

test("pruneDoses: doses older than seven days remain while residual is significant", () => {
    const now = new Date(2026, 8, 9, 22).getTime();
    const dose = { mg: 100, ts: new Date(2026, 7, 30, 22).getTime() };
    assert.ok(residualFor(dose, 100, now) >= 0.5);
    assert.deepEqual(pruneDoses([dose], 100, now), [dose]);
    assert.deepEqual(pruneDoses([dose], 5, now), []);
});

test("formatEstimate: formats local time with calendar-day offsets", () => {
    const now = new Date(2026, 8, 9, 20).getTime();
    assert.equal(formatEstimate(new Date(2026, 8, 9, 23, 5), "24", now), "23:05");
    assert.equal(formatEstimate(new Date(2026, 8, 10, 1, 5), "24", now), "01:05 +1d");
    assert.equal(formatEstimate(new Date(2026, 8, 11, 1, 5), "24", now), "01:05 +2d");
});

test("formatEstimate: compact 12h format distinguishes midnight and noon", () => {
    const now = new Date(2026, 8, 9, 0).getTime();
    assert.equal(formatEstimate(new Date(2026, 8, 9, 0, 5), "12", now), "12:05a");
    assert.equal(formatEstimate(new Date(2026, 8, 9, 12, 5), "12", now), "12:05p");
    assert.equal(formatEstimate(new Date(2026, 8, 9, 23, 5), "12", now), "11:05p");
    assert.equal(formatEstimate(new Date(2026, 8, 10, 1, 5), "12", now), "1:05a +1d");
});

test("formatEstimate: no threshold date or invalid dates produce no time", () => {
    assert.equal(formatEstimate(null), null);
    assert.equal(formatEstimate(undefined), null);
    assert.equal(formatEstimate(new Date(NaN)), null);
    assert.equal(formatEstimate("23:00"), null);
    assert.equal(formatClock(new Date(NaN)), null);
});

test("caffeineAtBedtime: projects to today's upcoming bedtime", () => {
    const now = new Date(2026, 8, 9, 18).getTime();
    assert.equal(caffeineAtBedtime(100, "23:00", 5, now), 50);
    assert.equal(caffeineAtBedtime(0, "23:00", 5, now), 0);
});

test("caffeineAtBedtime: after bedtime projects to the following local day", () => {
    const now = new Date(2026, 8, 9, 23, 30).getTime();
    const expected = 100 * Math.pow(0.5, 23.5 / 5);
    assert.equal(caffeineAtBedtime(100, "23:00", 5, now), expected);
});

test("caffeineAtBedtime: exact bedtime uses current mg and midnight is valid", () => {
    const now = new Date(2026, 8, 9, 23).getTime();
    assert.equal(caffeineAtBedtime(100, "23:00", 5, now), 100);
    assert.equal(caffeineAtBedtime(100, "00:00", 5, now), 100 * Math.pow(0.5, 1 / 5));
});

test("caffeineAtBedtime: invalid bedtime and half-life use the defaults", () => {
    const now = new Date(2026, 8, 9, 18).getTime();
    for (const bedtime of ["25:00", "23:60", "9:00", null]) {
        assert.equal(caffeineAtBedtime(100, bedtime, -5, now), 50);
    }
});

test("local date calculations: DST does not shift bedtime or calendar offsets", () => {
    const moduleUrl = new URL("./caffeine.js", import.meta.url).href;
    const script = `
        import assert from "node:assert/strict";
        import { formatEstimate, caffeineAtBedtime, pruneDoses } from ${JSON.stringify(moduleUrl)};
        const springNow = new Date(2026, 2, 7, 23, 30).getTime();
        assert.equal(formatEstimate(new Date(2026, 2, 9, 0, 15), "24", springNow), "00:15 +2d");
        const springBedtime = new Date(2026, 2, 8, 23).getTime();
        const springHours = (springBedtime - springNow) / 3600000;
        assert.equal(springHours, 22.5);
        assert.equal(caffeineAtBedtime(100, "23:00", 5, springNow), 100 * Math.pow(0.5, springHours / 5));
        const fallNow = new Date(2026, 9, 31, 23, 30).getTime();
        const fallBedtime = new Date(2026, 10, 1, 23).getTime();
        const fallHours = (fallBedtime - fallNow) / 3600000;
        assert.equal(fallHours, 24.5);
        assert.equal(caffeineAtBedtime(100, "23:00", 5, fallNow), 100 * Math.pow(0.5, fallHours / 5));
        const afterSpringJump = new Date(2026, 2, 8, 5).getTime();
        const nextEarlyBedtime = new Date(2026, 2, 9, 2, 30).getTime();
        const earlyHours = (nextEarlyBedtime - afterSpringJump) / 3600000;
        assert.equal(caffeineAtBedtime(100, "02:30", 5, afterSpringJump), 100 * Math.pow(0.5, earlyHours / 5));
        const historyNow = new Date(2026, 2, 10, 22).getTime();
        const cutoffDose = { mg: 1, ts: new Date(2026, 2, 3).getTime() };
        const previousDose = { mg: 1, ts: cutoffDose.ts - 1 };
        assert.deepEqual(pruneDoses([previousDose, cutoffDose], 5, historyNow), [cutoffDose]);
    `;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
        env: { ...process.env, TZ: "America/New_York" },
        encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
});
