// Caffeine Tracker - Stream Deck plugin (SDK v3)
//
// Every button logs ONE drink (label + dose mg, configured in the PI).
// Global state is shared across all buttons: the full dose log, half-life,
// sleep threshold, and bedtime. Press any button to log that drink, long-press
// to undo the most recent dose. Every button shows the same current mg and
// the same safe-to-sleep clock; only the label + dose differ per button.

import streamDeck, { SingletonAction } from "@elgato/streamdeck";
import { renderButton, renderUndoFlash } from "./renderer.js";
import {
    currentCaffeine,
    safeAt,
    formatClock,
    zoneFor,
    pruneDoses,
    countTodayForLabel,
    residualFor,
} from "./caffeine.js";
import { randomUUID } from "node:crypto";

// Anything held longer than this is treated as a "long press" (= undo).
const LONG_PRESS_MS = 700;
// How long the UNDO flash sticks before we render normal state again.
const UNDO_FLASH_MS = 900;
// How often we recompute + re-render every visible button.
const TICK_MS = 60_000;

// ---- Global state (shared across every placed button) ----
let globalState = {
    doses: [],          // [{ id, mg, label, ts }]
    halfLifeHours: 5,   // 3 - 8 configurable
    thresholdMg: 50,    // 25 - 100 configurable
};

// ---- Runtime maps (not persisted) ----
// Registered visible buttons so we can re-render them all on any state change.
const visibleActions = new Map(); // action.id -> { action, settings }
// keyDown timestamp per context to distinguish short vs long press on keyUp.
const keyDownTimes = new Map();   // action.id -> ms since epoch

// ---- Helpers ----

function normalizeActionSettings(raw) {
    return {
        label: String(raw?.label ?? "Coffee").trim().slice(0, 12) || "Coffee",
        dose: clampInt(raw?.dose, 1, 500, 95),
    };
}

function clampInt(val, min, max, fallback) {
    const n = parseInt(val, 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
}

function clampFloat(val, min, max, fallback) {
    const n = parseFloat(val);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
}

function applyGlobalSettings(raw) {
    if (!raw) return;
    globalState = {
        doses: Array.isArray(raw.doses) ? raw.doses : globalState.doses,
        halfLifeHours: clampFloat(raw.halfLifeHours, 3, 8, globalState.halfLifeHours),
        thresholdMg: clampInt(raw.thresholdMg, 25, 100, globalState.thresholdMg),
    };
}

async function saveGlobalState() {
    try {
        await streamDeck.settings.setGlobalSettings(globalState);
    } catch (err) {
        streamDeck.logger.error("Failed to save global settings:", err?.message);
    }
}

function computeSharedRender() {
    const mg = currentCaffeine(globalState.doses, globalState.halfLifeHours);
    const safe = safeAt(mg, globalState.thresholdMg, globalState.halfLifeHours);
    return {
        mg: Math.round(mg),
        safeTime: formatClock(safe),
        zone: zoneFor(mg),
    };
}

async function renderOne(action, settings) {
    const shared = computeSharedRender();
    const count = countTodayForLabel(globalState.doses, settings.label);
    try {
        await action.setImage(renderButton({
            label: settings.label,
            mg: shared.mg,
            safeTime: shared.safeTime,
            zone: shared.zone,
            count,
        }));
    } catch (err) {
        streamDeck.logger.error("renderOne failed:", err?.message);
    }
}

async function renderAll() {
    for (const { action, settings } of visibleActions.values()) {
        await renderOne(action, settings);
    }
}

async function addDose(mg, label) {
    globalState.doses.push({
        id: randomUUID(),
        mg: Number(mg) || 0,
        label: String(label || "drink"),
        ts: Date.now(),
    });
    await saveGlobalState();
    await renderAll();
}

async function undoLastDose() {
    if (globalState.doses.length === 0) return false;
    globalState.doses.pop();
    await saveGlobalState();
    return true;
}

async function clearAllDoses() {
    globalState.doses = [];
    await saveGlobalState();
    await renderAll();
}

// Remove a specific dose by id. Used by the PI's per-row delete button.
async function deleteDoseById(id) {
    const before = globalState.doses.length;
    globalState.doses = globalState.doses.filter(d => d.id !== id);
    if (globalState.doses.length !== before) {
        await saveGlobalState();
        await renderAll();
        return true;
    }
    return false;
}

// Update the timestamp of an existing dose. PI sends this when you drag the
// "hours ago" slider on a row.
async function editDoseTs(id, newTs) {
    const dose = globalState.doses.find(d => d.id === id);
    if (!dose) return false;
    const ts = Number(newTs);
    if (!Number.isFinite(ts) || ts <= 0 || ts > Date.now()) return false;
    dose.ts = ts;
    // Re-prune in case the edit pushed it over the decay threshold.
    globalState.doses = pruneDoses(globalState.doses, globalState.halfLifeHours);
    await saveGlobalState();
    await renderAll();
    return true;
}

// Add a dose with a user-specified timestamp (past or now).
// PI uses this for the "+ Add past dose" form.
async function addDoseAt(mg, label, ts) {
    const mgN = Number(mg) || 0;
    const tsN = Number(ts);
    if (mgN <= 0) return false;
    if (!Number.isFinite(tsN) || tsN <= 0 || tsN > Date.now()) return false;
    globalState.doses.push({
        id: randomUUID(),
        mg: mgN,
        label: String(label || "drink"),
        ts: tsN,
    });
    globalState.doses = pruneDoses(globalState.doses, globalState.halfLifeHours);
    await saveGlobalState();
    await renderAll();
    return true;
}

// Build the payload the PI uses to render both the summary and the dose table.
function buildStatusPayload() {
    const shared = computeSharedRender();
    const h = globalState.halfLifeHours;
    // newest-first so the most recent press is at the top of the list
    const doses = [...globalState.doses]
        .sort((a, b) => b.ts - a.ts)
        .map(d => ({
            id: d.id,
            mg: d.mg,
            label: d.label,
            ts: d.ts,
            residualMg: Math.round(residualFor(d, h) * 10) / 10,
        }));
    return {
        mg: shared.mg,
        safeTime: shared.safeTime,
        zone: shared.zone,
        doseCount: doses.length,
        halfLifeHours: h,
        thresholdMg: globalState.thresholdMg,
        doses,
    };
}

// ---- Action ----

class CaffeineDrink extends SingletonAction {
    manifestId = "com.teamvrotek.caffeinetracker.drink";

    async onWillAppear(ev) {
        const settings = normalizeActionSettings(ev.payload.settings);
        visibleActions.set(ev.action.id, { action: ev.action, settings });
        await renderOne(ev.action, settings);
    }

    async onWillDisappear(ev) {
        visibleActions.delete(ev.action.id);
        keyDownTimes.delete(ev.action.id);
    }

    async onDidReceiveSettings(ev) {
        const settings = normalizeActionSettings(ev.payload.settings);
        const entry = visibleActions.get(ev.action.id);
        if (entry) entry.settings = settings;
        await renderOne(ev.action, settings);
    }

    async onKeyDown(ev) {
        keyDownTimes.set(ev.action.id, Date.now());
    }

    async onKeyUp(ev) {
        const downAt = keyDownTimes.get(ev.action.id);
        keyDownTimes.delete(ev.action.id);
        const elapsed = downAt ? Date.now() - downAt : 0;
        const settings = normalizeActionSettings(ev.payload.settings);

        if (elapsed >= LONG_PRESS_MS) {
            // Long press = undo the last dose (global)
            const removed = await undoLastDose();
            if (removed) {
                // Flash UNDO briefly on the button that received the long-press,
                // then restore all buttons to the new shared state.
                try {
                    await ev.action.setImage(renderUndoFlash({
                        label: settings.label,
                        zone: computeSharedRender().zone,
                    }));
                } catch {}
                setTimeout(() => { renderAll().catch(() => {}); }, UNDO_FLASH_MS);
            } else {
                // Nothing to undo - just refresh in place
                await renderAll();
            }
        } else {
            // Short press = log a dose of this button's drink
            await addDose(settings.dose, settings.label);
        }
    }

    async onSendToPlugin(ev) {
        const msg = ev.payload;
        if (!msg || !msg.type) return;

        switch (msg.type) {
            case "getStatus":
                break; // just fall through to status echo
            case "saveGlobal":
                applyGlobalSettings(msg.settings);
                await saveGlobalState();
                await renderAll();
                break;
            case "clearDoses":
                await clearAllDoses();
                break;
            case "deleteDose":
                await deleteDoseById(msg.id);
                break;
            case "editDose":
                await editDoseTs(msg.id, msg.newTs);
                break;
            case "addDose":
                await addDoseAt(msg.mg, msg.label, msg.ts);
                break;
            default:
                return; // unknown message - ignore
        }

        // Every handled message echoes the latest state back so the PI's
        // dose list + summary stays in sync without a separate poll.
        await streamDeck.ui.sendToPropertyInspector({
            type: "statusUpdate",
            data: buildStatusPayload(),
        });
    }
}

// ---- Wire up ----

streamDeck.actions.registerAction(new CaffeineDrink());

// Listen for global-settings pushes from any source (e.g. PI calling setGlobalSettings directly).
streamDeck.settings.onDidReceiveGlobalSettings((ev) => {
    applyGlobalSettings(ev.settings);
    renderAll().catch((err) =>
        streamDeck.logger.error("renderAll failed on global update:", err?.message));
});

await streamDeck.connect();

// Load persisted state. connect() must finish first.
try {
    const raw = await streamDeck.settings.getGlobalSettings();
    applyGlobalSettings(raw);
    globalState.doses = pruneDoses(globalState.doses, globalState.halfLifeHours);
} catch (err) {
    streamDeck.logger.error("Initial global-state load failed:", err?.message);
}

await renderAll();

// Tick: prune + recompute + re-render every minute.
setInterval(async () => {
    const before = globalState.doses.length;
    globalState.doses = pruneDoses(globalState.doses, globalState.halfLifeHours);
    if (globalState.doses.length !== before) {
        await saveGlobalState();
    }
    await renderAll();
}, TICK_MS);
