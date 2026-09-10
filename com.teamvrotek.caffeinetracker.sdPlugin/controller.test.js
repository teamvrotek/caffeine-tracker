import { test } from "node:test";
import assert from "node:assert/strict";
import { setImmediate as flushTasks } from "node:timers/promises";
import { createTracker } from "./tracker.js";
import { registerActions } from "./controller.js";
import { renderButton, renderLoggedFlash, renderUndoFlash } from "./renderer.js";

const NOW = new Date(2026, 8, 9, 18).getTime();

function harness({ save, initial, ready } = {}) {
    const registered = new Map();
    const messages = [];
    const errors = [];
    let nextId = 0;
    const tracker = createTracker({ initial, save, now: () => NOW, makeId: () => `dose-${++nextId}` });
    class SingletonAction {}
    const streamDeck = {
        actions: { registerAction(action) { registered.set(action.manifestId, action); } },
        ui: {
            action: null,
            async sendToPropertyInspector(message) { messages.push(structuredClone(message)); },
        },
        logger: { error(...args) { errors.push(args); } },
    };
    const controller = registerActions(streamDeck, SingletonAction, tracker, ready);
    function key(id, kind = "drink", settings = {}) {
        const calls = { images: [], ok: 0, alert: 0 };
        const action = {
            id,
            manifestId: `com.teamvrotek.caffeinetracker.${kind}`,
            async setImage(image) { calls.images.push(image); },
            async showOk() { calls.ok++; },
            async showAlert() { calls.alert++; },
        };
        const handler = registered.get(action.manifestId);
        const event = { action, payload: { settings } };
        return { action, calls, handler, event };
    }
    return { tracker, controller, streamDeck, messages, errors, registered, key };
}

const svgFor = image => {
    assert.match(image, /^data:image\/svg\+xml;base64,/);
    return Buffer.from(image.split(",")[1], "base64").toString("utf8");
};

function mockClock(t) {
    t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: NOW });
}

async function advance(t, ms) {
    t.mock.timers.tick(ms);
    await flushTasks();
}

async function press(key) {
    await key.handler.onKeyDown(key.event);
    await key.handler.onKeyUp(key.event);
}

function renderOptions(h, key) {
    const entry = h.controller.visible.get(key.action.id);
    return { ...entry.settings, ...h.tracker.status(), kind: entry.kind,
        count: entry.kind === "drink" ? h.tracker.countToday(entry.settings.label) : 0 };
}

function expectFeedback(h, key, opacity) {
    assert.equal(key.calls.images.at(-1), renderLoggedFlash(renderOptions(h, key), opacity));
    assert.notEqual(key.calls.images.at(-1), renderButton(renderOptions(h, key)));
    assert.equal(key.calls.ok, 0, "success feedback must not call the SDK overlay");
}

function expectNormal(h, key) {
    assert.equal(key.calls.images.at(-1), renderButton(renderOptions(h, key)));
}

function pendingSave() {
    let finish;
    let entered;
    const completed = new Promise(resolve => { finish = resolve; });
    const started = new Promise(resolve => { entered = resolve; });
    return { started, finish, save: async () => { entered(); await completed; } };
}

test("status keys render but never log on key down or key up", async () => {
    let saves = 0;
    const h = harness({ save: async () => { saves++; } });
    const key = h.key("status-1", "status");
    await key.handler.onWillAppear(key.event);
    await key.handler.onKeyDown(key.event);
    await key.handler.onKeyUp(key.event);
    await key.handler.onKeyUp(key.event);
    assert.equal(h.tracker.status().doseCount, 0);
    assert.equal(saves, 0);
    assert.equal(key.calls.ok, 0);
    assert.equal(key.calls.alert, 0);
    assert.match(svgFor(key.calls.images[0]), /Estimated caffeine: 0 mg/);
});

function expectDisplay(h, key, statusDisplay) {
    assert.equal(key.calls.images.at(-1), renderButton({ ...renderOptions(h, key), statusDisplay }));
}

test("each status display reveals its alternate for five seconds without saving or logging", async t => {
    mockClock(t);
    for (const [home, alternate] of [["caffeine", "sleep"], ["sleep", "caffeine"], ["combined", "face"], ["face", "combined"]]) {
        let saves = 0;
        const h = harness({ save: async () => { saves++; } });
        const key = h.key("status-1", "status", { statusDisplay: home });
        await key.handler.onWillAppear(key.event);
        const original = key.calls.images.at(-1);
        await press(key);
        expectDisplay(h, key, alternate);
        assert.notEqual(key.calls.images.at(-1), original);
        await advance(t, 4999);
        expectDisplay(h, key, alternate);
        await advance(t, 1);
        expectDisplay(h, key, home);
        assert.equal(saves, 0);
        assert.equal(h.tracker.status().doseCount, 0);
        assert.equal(key.calls.ok, 0);
        assert.equal(key.calls.alert, 0);
    }
});

test("second status press returns early and the cancelled timer cannot interrupt a new reveal", async t => {
    mockClock(t);
    const h = harness();
    const key = h.key("status-1", "status", { statusDisplay: "face" });
    await key.handler.onWillAppear(key.event);
    await press(key);
    await advance(t, 1500);
    await press(key);
    expectDisplay(h, key, "face");
    await key.handler.onKeyUp(key.event);
    expectDisplay(h, key, "face");
    await press(key);
    await advance(t, 3500);
    expectDisplay(h, key, "combined");
    await advance(t, 1500);
    expectDisplay(h, key, "face");
});

test("status reveals remain live and independent while other keys log drinks", async t => {
    mockClock(t);
    const h = harness();
    const first = h.key("status-1", "status", { statusDisplay: "face" });
    const second = h.key("status-2", "status", { statusDisplay: "caffeine" });
    const drink = h.key("coffee-1", "drink", { dose: 95 });
    for (const key of [first, second, drink]) await key.handler.onWillAppear(key.event);
    await press(first);
    const before = first.calls.images.at(-1);
    await press(drink);
    expectDisplay(h, first, "combined");
    assert.notEqual(first.calls.images.at(-1), before);
    expectDisplay(h, second, "caffeine");
    await press(second);
    expectDisplay(h, first, "combined");
    expectDisplay(h, second, "sleep");
    await advance(t, 5000);
    expectDisplay(h, first, "face");
    expectDisplay(h, second, "caffeine");
    assert.equal(h.tracker.status().doseCount, 1);
});

test("holding a status key reveals information and never undoes a drink", async t => {
    mockClock(t);
    let saves = 0;
    const h = harness({ save: async () => { saves++; }, initial: { doses: [{ id: "earlier", label: "Coffee", mg: 95, ts: NOW }] } });
    const key = h.key("status-1", "status", { statusDisplay: "combined" });
    await key.handler.onWillAppear(key.event);
    await key.handler.onKeyDown(key.event);
    await advance(t, 1000);
    await key.handler.onKeyUp(key.event);
    expectDisplay(h, key, "face");
    assert.equal(h.tracker.status().doseCount, 1);
    assert.equal(saves, 0);
});

test("settings and key disappearance cancel status reveals and discard pending presses", async t => {
    mockClock(t);
    const h = harness();
    const key = h.key("status-1", "status", { statusDisplay: "face" });
    await key.handler.onWillAppear(key.event);
    await press(key);
    await key.handler.onKeyDown(key.event);
    await key.handler.onDidReceiveSettings({ action: key.action, payload: { settings: { statusDisplay: "sleep" } } });
    await key.handler.onKeyUp(key.event);
    expectDisplay(h, key, "sleep");
    const count = key.calls.images.length;
    await advance(t, 5000);
    assert.equal(key.calls.images.length, count);
    await press(key);
    expectDisplay(h, key, "caffeine");
    await key.handler.onWillDisappear(key.event);
    const replacement = h.key("status-1", "status", { statusDisplay: "combined" });
    await replacement.handler.onWillAppear(replacement.event);
    await replacement.handler.onKeyUp(replacement.event);
    await advance(t, 5000);
    expectDisplay(h, replacement, "combined");
    assert.equal(replacement.calls.images.length, 1);
});

test("a status press waiting for startup cannot affect a replacement key", async () => {
    let resolveReady;
    const h = harness({ ready: new Promise(resolve => { resolveReady = resolve; }) });
    const key = h.key("status-1", "status", { statusDisplay: "face" });
    const appearance = key.handler.onWillAppear(key.event);
    await key.handler.onKeyDown(key.event);
    const release = key.handler.onKeyUp(key.event);
    await key.handler.onWillDisappear(key.event);
    const replacement = h.key("status-1", "status", { statusDisplay: "caffeine" });
    const replacementAppearance = replacement.handler.onWillAppear(replacement.event);
    resolveReady();
    await Promise.all([appearance, release, replacementAppearance]);
    expectDisplay(h, replacement, "caffeine");
    assert.equal(replacement.calls.images.length, 1);
    assert.equal(key.calls.images.length, 0);
});

test("status inspector choices use the live values and preserve the configured preview during a reveal", async t => {
    mockClock(t);
    const h = harness({ initial: { doses: [{ id: "earlier", label: "Coffee", mg: 95, ts: NOW }] } });
    const key = h.key("status-1", "status", { statusDisplay: "face" });
    await key.handler.onWillAppear(key.event);
    h.streamDeck.ui.action = key.action;
    await press(key);
    await h.controller.sendStatus();
    const { statusDisplays, preview, settings } = h.messages.at(-1).data;
    assert.deepEqual(statusDisplays.map(display => display.id), ["caffeine", "sleep", "combined", "face"]);
    for (const display of statusDisplays) {
        assert.equal(display.preview, renderButton({ ...h.tracker.status(), kind: "status", statusDisplay: display.id }));
        assert.ok(display.alternateName);
    }
    assert.equal(settings.statusDisplay, "face");
    assert.equal(preview, renderButton(renderOptions(h, key)));
    expectDisplay(h, key, "combined");
});

test("one drink press logs once and unmatched key releases are ignored", async t => {
    mockClock(t);
    const h = harness();
    const key = h.key("coffee-1", "drink", { label: "Coffee", dose: 95 });
    await key.handler.onWillAppear(key.event);
    await key.handler.onKeyUp(key.event);
    assert.equal(h.tracker.status().doseCount, 0);
    await key.handler.onKeyDown(key.event);
    await key.handler.onKeyUp(key.event);
    await key.handler.onKeyUp(key.event);
    assert.deepEqual(h.tracker.snapshot().doses.map(dose => dose.mg), [95]);
    expectFeedback(h, key, 1);
    assert.equal(key.calls.alert, 0);
});

test("a zero caffeine key logs its drink and acknowledges the press", async t => {
    mockClock(t);
    const h = harness();
    const key = h.key("zero-1", "drink", { drinkId: "cola-free", label: "Coke Zero-Zero", dose: 0 });
    await key.handler.onWillAppear(key.event);
    await key.handler.onKeyDown(key.event);
    await key.handler.onKeyUp(key.event);
    assert.equal(h.tracker.status().doseCount, 1);
    assert.equal(h.tracker.status().mg, 0);
    assert.equal(h.tracker.snapshot().doses[0].mg, 0);
    expectFeedback(h, key, 1);
});

test("a failed drink save alerts without showing success or committing history", async () => {
    const h = harness({ save: async () => { throw new Error("Storage unavailable"); } });
    const key = h.key("coffee-1", "drink", { dose: 95 });
    h.streamDeck.ui.action = key.action;
    await key.handler.onWillAppear(key.event);
    await key.handler.onKeyDown(key.event);
    await key.handler.onKeyUp(key.event);
    assert.equal(h.tracker.status().doseCount, 0);
    assert.equal(key.calls.ok, 0);
    assert.equal(key.calls.alert, 1);
    assert.equal(h.errors.length, 1);
    assert.deepEqual(h.messages.at(-1), { type: "error", message: "Storage unavailable" });
    assert.equal(key.calls.images.length, 1, "a failed save must never send a confirmation frame");
    expectNormal(h, key);
});

test("the inspector gets the catalog, independent artwork choices and actual SVG preview", async () => {
    const h = harness();
    const key = h.key("status-1", "status");
    h.streamDeck.ui.action = key.action;
    await key.handler.onWillAppear(key.event);
    await key.handler.onPropertyInspectorDidAppear(key.event);
    const message = h.messages.at(-1);
    assert.equal(message.type, "statusUpdate");
    assert.ok(message.data.catalog.some(drink => drink.id === "cola-free" && drink.servings.some(serving => serving.dose === 0)));
    assert.ok(message.data.artwork.some(art => art.id === "espresso"));
    assert.ok(message.data.artwork.some(art => art.id === "cola-free"));
    assert.equal(message.data.settings.showSleep, true);
    assert.equal(message.data.preview, key.calls.images.at(-1));
    const svg = svgFor(message.data.preview);
    assert.match(svg, /<svg\b/);
    assert.match(svg, /Estimated caffeine: 0 mg; sleep estimate: Now/);
});

test("manual history and preferences are shared across drink and status keys", async () => {
    const h = harness();
    const drink = h.key("coffee-1", "drink", { dose: 95 });
    const status = h.key("status-1", "status");
    await drink.handler.onWillAppear(drink.event);
    await status.handler.onWillAppear(status.event);
    h.streamDeck.ui.action = drink.action;
    const oldTime = new Date(2026, 8, 5, 9, 45).getTime();
    await drink.handler.onSendToPlugin({ action: drink.action, payload: { type: "addDose", label: "Manual tea", mg: 47, ts: oldTime } });
    const drinkHistory = h.messages.at(-1).data.doses;
    assert.equal(drinkHistory.length, 1);
    h.streamDeck.ui.action = status.action;
    await status.handler.onSendToPlugin({ action: status.action, payload: { type: "getStatus" } });
    assert.deepEqual(h.messages.at(-1).data.doses, drinkHistory);
    await status.handler.onSendToPlugin({ action: status.action, payload: { type: "saveGlobal", settings: { bedtime: "22:30", doses: [] } } });
    assert.equal(h.tracker.status().bedtime, "22:30");
    assert.deepEqual(h.messages.at(-1).data.doses, drinkHistory);
    const corrected = new Date(2026, 8, 5, 10, 15).getTime();
    await status.handler.onSendToPlugin({ action: status.action, payload: { type: "editDose", id: drinkHistory[0].id, newTs: corrected } });
    h.streamDeck.ui.action = drink.action;
    await drink.handler.onSendToPlugin({ action: drink.action, payload: { type: "getStatus" } });
    assert.equal(h.messages.at(-1).data.doses[0].ts, corrected);
    assert.ok(drink.calls.images.length >= 3);
    assert.ok(status.calls.images.length >= 3);
});

test("a key appearance waits for initial state before sending its image", async () => {
    let resolveReady;
    const ready = new Promise(resolve => { resolveReady = resolve; });
    const h = harness({ ready });
    const key = h.key("status-1", "status");
    const appearance = key.handler.onWillAppear(key.event);
    assert.equal(key.calls.images.length, 0);
    resolveReady();
    await appearance;
    assert.equal(key.calls.images.length, 1);
});

test("a quick press during startup remains a drink log after settings finish loading", async t => {
    mockClock(t);
    let resolveReady;
    const ready = new Promise(resolve => { resolveReady = resolve; });
    const h = harness({ ready, initial: { doses: [{ id: "earlier", label: "Coffee", mg: 95, ts: NOW - 3_600_000 }] } });
    const key = h.key("coffee-1", "drink", { dose: 95 });
    const appearance = key.handler.onWillAppear(key.event);
    await key.handler.onKeyDown(key.event);
    await advance(t, 100);
    const release = key.handler.onKeyUp(key.event);
    await advance(t, 2000);
    assert.equal(h.tracker.status().doseCount, 1);
    resolveReady();
    await Promise.all([appearance, release]);
    assert.equal(h.tracker.status().doseCount, 2);
    assert.equal(h.tracker.snapshot().doses[0].id, "earlier");
    expectFeedback(h, key, 1);
});

test("a disappearing key discards its pending press", async () => {
    const h = harness();
    const key = h.key("coffee-1", "drink", { dose: 95 });
    await key.handler.onWillAppear(key.event);
    await key.handler.onKeyDown(key.event);
    await key.handler.onWillDisappear(key.event);
    await key.handler.onKeyUp(key.event);
    assert.equal(h.tracker.status().doseCount, 0);
});

test("successful persistence starts confirmation, fades it and restores the live key", async t => {
    mockClock(t);
    const pending = pendingSave();
    const h = harness({ save: pending.save });
    const key = h.key("coffee-1", "drink", { dose: 95, layout: "combined", showSleep: true });
    await key.handler.onWillAppear(key.event);
    await key.handler.onKeyDown(key.event);
    const release = key.handler.onKeyUp(key.event);
    await pending.started;
    assert.equal(h.tracker.status().doseCount, 0);
    assert.equal(key.calls.images.length, 1);
    expectNormal(h, key);
    pending.finish();
    await release;
    assert.equal(h.tracker.status().doseCount, 1);
    expectFeedback(h, key, 1);
    await advance(t, 2399);
    expectFeedback(h, key, 1);
    await advance(t, 1);
    expectFeedback(h, key, 0.65);
    await advance(t, 300);
    expectFeedback(h, key, 0.25);
    await advance(t, 299);
    expectFeedback(h, key, 0.25);
    await advance(t, 1);
    expectNormal(h, key);
});

test("a repeated press restarts confirmation and old timers cannot replace its frames", async t => {
    mockClock(t);
    const h = harness();
    const key = h.key("coffee-1", "drink", { dose: 95 });
    await key.handler.onWillAppear(key.event);
    await press(key);
    await advance(t, 2500);
    expectFeedback(h, key, 0.65);
    await press(key);
    expectFeedback(h, key, 1);
    const imagesAfterSecondPress = key.calls.images.length;
    await advance(t, 500);
    expectFeedback(h, key, 1);
    assert.equal(key.calls.images.length, imagesAfterSecondPress, "the previous fade and restore timers must be cancelled");
    await advance(t, 1900);
    expectFeedback(h, key, 0.65);
    await advance(t, 300);
    expectFeedback(h, key, 0.25);
    await advance(t, 300);
    expectNormal(h, key);
    assert.equal(h.tracker.status().doseCount, 2);
});

test("the daily badge increments across matching drink keys and remains after confirmation", async t => {
    mockClock(t);
    const h = harness();
    const coffee = h.key("coffee-1", "drink", { label: "Coffee", dose: 95 });
    const large = h.key("coffee-2", "drink", { label: "Coffee", icon: "latte", dose: 190, quantity: 2 });
    const tea = h.key("tea-1", "drink", { drinkId: "tea", label: "Black Tea", dose: 47 });
    for (const key of [coffee, large, tea]) await key.handler.onWillAppear(key.event);
    assert.doesNotMatch(svgFor(large.calls.images.at(-1)), /×/);
    await press(coffee);
    assert.match(svgFor(coffee.calls.images.at(-1)), />1×<\/text>/);
    assert.match(svgFor(large.calls.images.at(-1)), />1×<\/text>/);
    await press(large);
    for (const key of [coffee, large]) assert.match(svgFor(key.calls.images.at(-1)), />2×<\/text>/);
    assert.doesNotMatch(svgFor(tea.calls.images.at(-1)), /×/);
    assert.deepEqual(h.tracker.snapshot().doses.map(dose => dose.mg), [95, 190]);
    await advance(t, 3000);
    for (const key of [coffee, large]) {
        expectNormal(h, key);
        assert.match(svgFor(key.calls.images.at(-1)), />2×<\/text>/);
    }
    h.streamDeck.ui.action = coffee.action;
    await coffee.handler.onSendToPlugin({ action: coffee.action, payload: { type: "editDose",
        id: h.tracker.snapshot().doses[0].id, newTs: new Date(2026, 8, 8, 18).getTime() } });
    for (const key of [coffee, large]) assert.match(svgFor(key.calls.images.at(-1)), />1×<\/text>/);
    assert.match(svgFor(h.messages.at(-1).data.preview), />1×<\/text>/);
});

test("disappearing cancels every confirmation timer and reappearing starts normally", async t => {
    mockClock(t);
    const h = harness();
    const key = h.key("coffee-1", "drink", { dose: 95 });
    await key.handler.onWillAppear(key.event);
    await press(key);
    const imageCount = key.calls.images.length;
    await key.handler.onWillDisappear(key.event);
    await advance(t, 3200);
    assert.equal(key.calls.images.length, imageCount);
    await key.handler.onWillAppear(key.event);
    expectNormal(h, key);
});

test("settings changes cancel confirmation and retain the new normal artwork", async t => {
    mockClock(t);
    const h = harness();
    const key = h.key("coffee-1", "drink", { dose: 95 });
    await key.handler.onWillAppear(key.event);
    await press(key);
    await advance(t, 100);
    await key.handler.onDidReceiveSettings({ action: key.action, payload: { settings: { drinkId: "cola-free", icon: "cola-free", label: "Coke Zero-Zero", dose: 0 } } });
    expectNormal(h, key);
    const imageCount = key.calls.images.length;
    await advance(t, 3200);
    expectNormal(h, key);
    assert.equal(key.calls.images.length, imageCount);
    assert.equal(h.tracker.snapshot().doses[0].mg, 95);
});

test("settings changes during persistence cancel the pending confirmation", async t => {
    mockClock(t);
    const pending = pendingSave();
    const h = harness({ save: pending.save });
    const key = h.key("coffee-1", "drink", { dose: 95 });
    await key.handler.onWillAppear(key.event);
    await key.handler.onKeyDown(key.event);
    const release = key.handler.onKeyUp(key.event);
    await pending.started;
    await key.handler.onDidReceiveSettings({ action: key.action, payload: { settings: { drinkId: "cola-free", icon: "cola-free", label: "Coke Zero-Zero", dose: 0 } } });
    pending.finish();
    await release;
    assert.equal(h.tracker.snapshot().doses[0].mg, 95);
    expectNormal(h, key);
    const imageCount = key.calls.images.length;
    await advance(t, 3200);
    assert.equal(key.calls.images.length, imageCount);
});

test("disappearance during persistence cannot start confirmation on a replacement key", async t => {
    mockClock(t);
    const pending = pendingSave();
    const h = harness({ save: pending.save });
    const key = h.key("coffee-1", "drink", { dose: 95 });
    await key.handler.onWillAppear(key.event);
    await key.handler.onKeyDown(key.event);
    const release = key.handler.onKeyUp(key.event);
    await pending.started;
    await key.handler.onWillDisappear(key.event);
    const replacement = h.key("coffee-1", "drink", { dose: 0, drinkId: "cola-free" });
    await replacement.handler.onWillAppear(replacement.event);
    pending.finish();
    await release;
    assert.equal(h.tracker.snapshot().doses[0].mg, 95);
    expectNormal(h, replacement);
    const oldImages = key.calls.images.length;
    const replacementImages = replacement.calls.images.length;
    await advance(t, 3200);
    assert.equal(key.calls.images.length, oldImages);
    assert.equal(replacement.calls.images.length, replacementImages);
});

test("undo feedback lasts 1000 ms before restoring the live key", async t => {
    mockClock(t);
    const dose = { id: "original", label: "Coffee", mg: 95, ts: NOW };
    const h = harness({ initial: { doses: [dose] } });
    const key = h.key("coffee-1", "drink", { dose: 95 });
    await key.handler.onWillAppear(key.event);
    const removed = h.tracker.snapshot().doses[0];
    await key.handler.onKeyDown(key.event);
    await advance(t, 700);
    await key.handler.onKeyUp(key.event);
    const undoImage = renderUndoFlash({ ...removed, dose: removed.mg });
    assert.equal(key.calls.images.at(-1), undoImage);
    assert.equal(h.tracker.status().doseCount, 0);
    await advance(t, 999);
    assert.equal(key.calls.images.at(-1), undoImage);
    await advance(t, 1);
    expectNormal(h, key);
});

test("a fresh drink confirmation cancels the previous undo restore timer", async t => {
    mockClock(t);
    const h = harness({ initial: { doses: [{ id: "original", label: "Coffee", mg: 95, ts: NOW }] } });
    const key = h.key("coffee-1", "drink", { dose: 95 });
    await key.handler.onWillAppear(key.event);
    await key.handler.onKeyDown(key.event);
    await advance(t, 700);
    await key.handler.onKeyUp(key.event);
    await advance(t, 800);
    await press(key);
    expectFeedback(h, key, 1);
    const imageCount = key.calls.images.length;
    await advance(t, 200);
    expectFeedback(h, key, 1);
    assert.equal(key.calls.images.length, imageCount);
    await advance(t, 2800);
    expectNormal(h, key);
    assert.equal(h.tracker.status().doseCount, 1);
});
