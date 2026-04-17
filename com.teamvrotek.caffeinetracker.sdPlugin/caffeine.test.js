// Sanity tests for the caffeine math. Run with: node --test caffeine.test.js
// Uses Node's built-in test runner (no deps).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    currentCaffeine,
    safeAt,
    formatClock,
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

test("pruneDoses: drops doses whose residual is below 0.5mg", () => {
    const now = 1_000_000_000_000;
    // A tiny dose from long ago that decayed to near zero
    const doses = [
        { mg: 5, ts: now - 20 * HOUR }, // residual ~ 5 * 0.5^4 = 0.31mg
    ];
    const result = pruneDoses(doses, 5, now);
    assert.equal(result.length, 0);
});

test("pruneDoses: drops 95mg dose after ~40h (full decay)", () => {
    const now = 1_000_000_000_000;
    // 95 * 0.5^(40/5) = 95 * 0.0039 = 0.37mg (below threshold)
    const doses = [
        { mg: 95, ts: now - 40 * HOUR },
    ];
    const result = pruneDoses(doses, 5, now);
    assert.equal(result.length, 0);
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

test("countTodayForLabel: case-insensitive match", () => {
    const now = new Date("2026-04-17T14:00:00").getTime();
    const doses = [
        { label: "coffee", ts: new Date("2026-04-17T08:00:00").getTime() },
        { label: "COFFEE", ts: new Date("2026-04-17T11:00:00").getTime() },
    ];
    assert.equal(countTodayForLabel(doses, "Coffee", now), 2);
});

test("countTodayForLabel: empty / bad input", () => {
    assert.equal(countTodayForLabel([], "Coffee"), 0);
    assert.equal(countTodayForLabel(null, "Coffee"), 0);
    assert.equal(countTodayForLabel([{ label: "Coffee", ts: Date.now() }], ""), 0);
});
