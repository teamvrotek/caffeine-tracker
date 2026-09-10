import { randomUUID } from "node:crypto";
import { normalizeActionSettings, normalizePreferences } from "./config.js";
import { currentCaffeine, safeAt, formatEstimate, zoneFor, pruneDoses, residualFor, caffeineAtBedtime, countTodayForLabel } from "./caffeine.js";

function normalizeState(raw = {}) {
    const doses = (Array.isArray(raw?.doses) ? raw.doses : []).filter(dose =>
        dose && Number.isFinite(Number(dose.mg)) && Number(dose.mg) >= 0
        && Number.isFinite(Number(dose.ts)) && Number(dose.ts) > 0
    ).map((dose, index) => ({
        ...dose,
        id: typeof dose.id === "string" && dose.id ? dose.id : `legacy-${index}-${dose.ts}`,
        ...normalizeActionSettings({ ...dose, dose: dose.mg }),
        mg: Number(dose.mg), ts: Number(dose.ts),
    }));
    return { ...normalizePreferences(raw || {}), doses };
}

// Serial writes avoid losing a drink when two keys are pressed together.
// A failed write does not replace the last successfully saved in-memory state.
export function createTracker({ initial = {}, save = async () => {}, now = Date.now, makeId = randomUUID } = {}) {
    let state = normalizeState(initial);
    let queue = Promise.resolve();
    const unchanged = Symbol("unchanged");
    const transact = (change, persist = true) => {
        const operation = queue.then(async () => {
            const next = structuredClone(state);
            const result = change(next);
            if (result === unchanged) return;
            if (persist) await save(next);
            state = next;
            return result;
        });
        queue = operation.catch(() => {});
        return operation;
    };
    const validateTime = ts => {
        const value = Number(ts);
        if (!Number.isFinite(value) || value <= 0 || value > now()) throw new Error("Choose a valid date and time in the past.");
        return value;
    };
    return {
        snapshot: () => structuredClone(state),
        countToday: label => countTodayForLabel(state.doses, label, now()),
        replace: raw => transact(next => Object.assign(next, normalizeState(raw)), false),
        add: input => transact(next => {
            const mg = Number(input.mg ?? input.dose);
            if (!Number.isInteger(mg) || mg < 0 || mg > 500) throw new Error("Enter caffeine between 0 and 500 mg.");
            const ts = validateTime(input.ts ?? now());
            const settings = normalizeActionSettings({ ...input, dose: mg });
            const dose = { id: makeId(), mg, ts, addedAt: now(), label: settings.label, drinkId: settings.drinkId, icon: settings.icon, quantity: settings.quantity };
            next.doses.push(dose);
            return dose;
        }),
        undo: () => transact(next => next.doses.pop() || null),
        edit: (id, ts) => transact(next => {
            const dose = next.doses.find(item => item.id === id);
            if (!dose) throw new Error("That drink is no longer in your history.");
            dose.ts = validateTime(ts);
        }),
        remove: id => transact(next => {
            if (!next.doses.some(item => item.id === id)) throw new Error("That drink is no longer in your history.");
            next.doses = next.doses.filter(item => item.id !== id);
        }),
        clear: () => transact(next => { next.doses = []; }),
        preferences: raw => transact(next => Object.assign(next, normalizePreferences(raw, next))),
        prune: () => transact(next => {
            const retained = pruneDoses(next.doses, next.halfLifeHours, now());
            if (retained.length === next.doses.length) return unchanged;
            next.doses = retained;
        }),
        status: () => {
            const time = now();
            const mg = currentCaffeine(state.doses, state.halfLifeHours, time);
            const sleep = safeAt(mg, state.thresholdMg, state.halfLifeHours, time);
            return {
                ...normalizePreferences(state), mg: Math.round(mg),
                safeTime: formatEstimate(sleep, state.timeFormat, time),
                zone: zoneFor(mg), doseCount: state.doses.length,
                bedtimeMg: Math.round(caffeineAtBedtime(mg, state.bedtime, state.halfLifeHours, time)),
                doses: [...state.doses].sort((a, b) => b.ts - a.ts).map(dose => ({ ...dose, residualMg: Math.round(residualFor(dose, state.halfLifeHours, time) * 10) / 10 })),
            };
        },
    };
}
