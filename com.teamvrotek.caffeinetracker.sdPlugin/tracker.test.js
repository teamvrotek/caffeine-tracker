import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeActionSettings } from "./config.js";
import { createTracker } from "./tracker.js";

const NOW = new Date(2026, 8, 9, 18).getTime();
const deferred = () => {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
};

test("status display migration preserves existing keys and honors an explicit display", () => {
    assert.equal(normalizeActionSettings({}, "status").statusDisplay, "combined");
    assert.equal(normalizeActionSettings({ showSleep: true }, "status").statusDisplay, "combined");
    assert.equal(normalizeActionSettings({ showSleep: false }, "status").statusDisplay, "caffeine");
    for (const statusDisplay of ["caffeine", "sleep", "combined", "face"]) {
        for (const showSleep of [false, true]) {
            assert.equal(normalizeActionSettings({ statusDisplay, showSleep }, "status").statusDisplay, statusDisplay);
        }
    }
    assert.equal(normalizeActionSettings({ statusDisplay: "bad", showSleep: false }, "status").statusDisplay, "caffeine");
    const drink = normalizeActionSettings({ statusDisplay: "face", showSleep: true }, "drink");
    assert.equal(drink.showSleep, true);
    assert.equal(drink.statusDisplay, undefined);
});

test("legacy key settings preserve a custom label and caffeine amount", () => {
    const settings = normalizeActionSettings({ label: "My office coffee", dose: 87 });
    assert.equal(settings.label, "My office coffee");
    assert.equal(settings.dose, 87);
    assert.equal(settings.drinkId, "custom");
    assert.equal(settings.servingId, "custom");
});

test("artwork can change without changing the configured drink or amount", () => {
    const settings = normalizeActionSettings({ drinkId: "coffee", label: "My coffee", dose: 112, icon: "cola-free" });
    assert.equal(settings.icon, "cola-free");
    assert.equal(settings.drinkId, "coffee");
    assert.equal(settings.label, "My coffee");
    assert.equal(settings.dose, 112);
    const zero = normalizeActionSettings({ drinkId: "cola-free", dose: 0, icon: "coffee" });
    assert.equal(zero.dose, 0);
    assert.equal(zero.icon, "coffee");
});

test("legacy history preserves its label, caffeine amount and original timestamp", () => {
    const ts = NOW - 4 * 3_600_000;
    const tracker = createTracker({ initial: { doses: [{ label: "Office special", mg: 123, ts }] }, now: () => NOW });
    const [dose] = tracker.snapshot().doses;
    assert.equal(dose.label, "Office special");
    assert.equal(dose.mg, 123);
    assert.equal(dose.ts, ts);
    assert.ok(dose.id);
    assert.equal(tracker.status().doseCount, 1);
});

test("zero caffeine drinks persist through pruning and can be undone", async () => {
    const saves = [];
    const tracker = createTracker({ save: async state => saves.push(structuredClone(state)), now: () => NOW, makeId: () => "zero-1" });
    const dose = await tracker.add({ drinkId: "cola-free", label: "Coke Zero-Zero", mg: 0 });
    await tracker.prune();
    assert.equal(dose.mg, 0);
    assert.equal(tracker.status().mg, 0);
    assert.equal(tracker.status().doseCount, 1);
    assert.equal(tracker.countToday("coke zero-zero"), 1);
    assert.equal(saves.at(-1).doses[0].mg, 0);
    const undone = await tracker.undo();
    assert.equal(undone.id, "zero-1");
    assert.deepEqual(tracker.snapshot().doses, []);
    assert.deepEqual(saves.at(-1).doses, []);
    assert.equal(tracker.countToday("Coke Zero-Zero"), 0);
});

test("preferences cannot replace or inject history", async () => {
    const tracker = createTracker({ now: () => NOW, makeId: () => "real" });
    await tracker.add({ label: "Coffee", mg: 95 });
    const before = tracker.snapshot().doses;
    await tracker.preferences({ halfLifeHours: 6, doses: [{ id: "injected", mg: 500, ts: NOW }], doseCount: 99 });
    assert.equal(tracker.snapshot().halfLifeHours, 6);
    assert.deepEqual(tracker.snapshot().doses, before);
    assert.equal(tracker.status().doseCount, 1);
});

test("concurrent logs are serialized without losing either drink", async () => {
    const firstSaveStarted = deferred();
    const allowFirstSave = deferred();
    const saves = [];
    let id = 0;
    const tracker = createTracker({
        now: () => NOW,
        makeId: () => `dose-${++id}`,
        save: async state => {
            saves.push(structuredClone(state));
            if (saves.length === 1) {
                firstSaveStarted.resolve();
                await allowFirstSave.promise;
            }
        },
    });
    const coffee = tracker.add({ label: "Coffee", mg: 95 });
    await firstSaveStarted.promise;
    const tea = tracker.add({ label: "Black Tea", mg: 47 });
    assert.equal(tracker.snapshot().doses.length, 0, "an unfinished save must not commit in memory");
    assert.equal(tracker.countToday("Coffee"), 0);
    assert.equal(saves.length, 1);
    allowFirstSave.resolve();
    await Promise.all([coffee, tea]);
    assert.deepEqual(tracker.snapshot().doses.map(dose => dose.mg), [95, 47]);
    assert.deepEqual(saves.map(state => state.doses.length), [1, 2]);
    assert.equal(tracker.countToday("Coffee"), 1);
    assert.equal(tracker.countToday("Black Tea"), 1);
});

test("a failed save rejects without committing and the queue remains usable", async () => {
    let calls = 0;
    const tracker = createTracker({ now: () => NOW, save: async () => { if (++calls === 1) throw new Error("Disk unavailable"); } });
    await assert.rejects(tracker.add({ label: "Coffee", mg: 95 }), /Disk unavailable/);
    assert.equal(tracker.status().doseCount, 0);
    assert.equal(tracker.countToday("Coffee"), 0);
    assert.deepEqual(tracker.snapshot().doses, []);
    await tracker.add({ label: "Black Tea", mg: 47 });
    assert.deepEqual(tracker.snapshot().doses.map(dose => dose.mg), [47]);
});

test("editing a full timestamp preserves the chosen historical calendar day", async () => {
    const tracker = createTracker({ now: () => NOW, makeId: () => "historical" });
    const original = new Date(2026, 8, 5, 8, 15).getTime();
    const corrected = new Date(2026, 8, 5, 9, 45).getTime();
    await tracker.add({ label: "Coffee", mg: 95, ts: original });
    await tracker.edit("historical", corrected);
    const [dose] = tracker.status().doses;
    assert.equal(dose.ts, corrected);
    assert.equal(new Date(dose.ts).getDate(), 5);
    assert.equal(new Date(dose.ts).getHours(), 9);
    assert.equal(new Date(dose.ts).getMinutes(), 45);
});

test("future timestamp edits fail without changing the saved entry", async () => {
    const tracker = createTracker({ now: () => NOW, makeId: () => "original" });
    await tracker.add({ mg: 95, ts: NOW - 3_600_000 });
    const before = tracker.snapshot();
    await assert.rejects(tracker.edit("original", NOW + 60_000), /past/);
    assert.deepEqual(tracker.snapshot(), before);
});

test("daily counts group matching labels across different artwork, dose and serving sizes", async () => {
    const tracker = createTracker({ now: () => NOW });
    await tracker.add({ label: "Coffee", mg: 95, icon: "coffee", quantity: 1 });
    await tracker.add({ label: " coffee ", mg: 190, icon: "cola", quantity: 2 });
    await tracker.add({ label: "Espresso", mg: 128, icon: "espresso", quantity: 2 });
    await tracker.add({ label: "My custom drink", mg: 0, icon: "coffee" });
    assert.equal(tracker.countToday("COFFEE"), 2);
    assert.equal(tracker.countToday("Espresso"), 1);
    assert.equal(tracker.countToday(" My Custom Drink "), 1);
    assert.equal(tracker.countToday("Tea"), 0);
});

test("daily counts reflect saved timestamp edits, removals and undo", async () => {
    let nextId = 0;
    const tracker = createTracker({ now: () => NOW, makeId: () => `drink-${++nextId}` });
    const first = await tracker.add({ label: "Coffee", mg: 95 });
    const second = await tracker.add({ label: "Coffee", mg: 0 });
    assert.equal(tracker.countToday("Coffee"), 2);
    await tracker.edit(first.id, new Date(2026, 8, 8, 12).getTime());
    assert.equal(tracker.countToday("Coffee"), 1);
    await tracker.edit(first.id, new Date(2026, 8, 9, 12).getTime());
    assert.equal(tracker.countToday("Coffee"), 2);
    await tracker.remove(second.id);
    assert.equal(tracker.countToday("Coffee"), 1);
    await tracker.undo();
    assert.equal(tracker.countToday("Coffee"), 0);
});

test("daily counts reset at local midnight using the injected clock", async () => {
    let now = new Date(2026, 8, 9, 23, 59, 59).getTime();
    const tracker = createTracker({ now: () => now });
    await tracker.add({ label: "Coffee", mg: 95 });
    assert.equal(tracker.countToday("Coffee"), 1);
    now = new Date(2026, 8, 10, 0, 0, 0).getTime();
    assert.equal(tracker.countToday("Coffee"), 0);
    assert.equal(tracker.snapshot().doses.length, 1);
    await tracker.add({ label: "Coffee", mg: 95 });
    assert.equal(tracker.countToday("Coffee"), 1);
    assert.equal(tracker.snapshot().doses.length, 2);
});

test("daily counts survive decay, pruning and reloading saved legacy history", async () => {
    let saved = { doses: [
        { label: " Coffee ", mg: 1, ts: new Date(2026, 8, 9, 0).getTime() },
        { label: "COFFEE", mg: 0, ts: new Date(2026, 8, 9, 1).getTime() },
        { label: "Coffee", mg: 95, ts: new Date(2026, 8, 8, 18).getTime() },
    ] };
    const tracker = createTracker({
        now: () => NOW,
        save: async state => { saved = structuredClone(state); },
        initial: saved,
    });
    assert.equal(tracker.countToday("Coffee"), 2);
    await tracker.prune();
    assert.equal(tracker.countToday("Coffee"), 2);
    const reloaded = createTracker({ initial: saved, now: () => NOW });
    assert.equal(reloaded.countToday(" coffee "), 2);
    assert.equal(reloaded.snapshot().doses.length, 3);
});

test("minute pruning saves only when retained history changes", async () => {
    let now = NOW;
    const saves = [];
    const tracker = createTracker({
        now: () => now,
        save: async state => { saves.push(structuredClone(state)); },
    });
    await tracker.prune();
    await tracker.prune();
    assert.equal(saves.length, 0, "empty minute ticks must not write settings");
    await tracker.add({ label: "Coffee", mg: 95 });
    await tracker.prune();
    now += 60_000;
    await tracker.prune();
    assert.equal(saves.length, 1, "decay without history removal must not write settings");
    assert.equal(tracker.snapshot().doses.length, 1);
    now += 9 * 24 * 3_600_000;
    await tracker.prune();
    assert.equal(saves.length, 2);
    assert.deepEqual(saves.at(-1).doses, []);
    await tracker.prune();
    assert.equal(saves.length, 2);
});

test("pruning failure retains history and a later minute tick can retry", async () => {
    let rejectSave = true;
    const tracker = createTracker({
        now: () => NOW,
        initial: { doses: [{ id: "old", label: "Coffee", mg: 95, ts: NOW - 9 * 24 * 3_600_000 }] },
        save: async () => { if (rejectSave) throw new Error("Storage unavailable"); },
    });
    await assert.rejects(tracker.prune(), /Storage unavailable/);
    assert.equal(tracker.snapshot().doses.length, 1);
    rejectSave = false;
    await tracker.prune();
    assert.deepEqual(tracker.snapshot().doses, []);
});

test("daily counts ignore future history and tolerate an invalid injected clock", () => {
    let now = NOW;
    const tracker = createTracker({
        now: () => now,
        initial: { doses: [
            { label: "Coffee", mg: 95, ts: NOW },
            { label: "Coffee", mg: 95, ts: NOW + 60_000 },
        ] },
    });
    assert.equal(tracker.countToday("Coffee"), 1);
    now = NaN;
    assert.equal(tracker.countToday("Coffee"), 0);
});
