import { CATALOG, ARTWORK, STATUS_DISPLAYS, normalizeActionSettings } from "./config.js";
import { renderButton, renderUndoFlash, renderLoggedFlash } from "./renderer.js";

export function registerActions(streamDeck, SingletonAction, tracker, ready = Promise.resolve()) {
    const visible = new Map();
    const pressed = new Map();
    const flashes = new Map();
    const optionsFor = (entry, status = tracker.status()) => ({ ...entry.settings, ...status, kind: entry.kind,
        count: entry.kind === "drink" ? tracker.countToday(entry.settings.label) : 0 });
    const imageFor = entry => renderButton(optionsFor(entry));
    async function renderOne(entry) {
        const flash = flashes.get(entry.action.id);
        await entry.action.setImage(flash?.until > Date.now() ? flash.render(flash.opacity) : imageFor(entry));
    }
    function clearFlash(id) {
        const flash = flashes.get(id);
        if (flash) for (const timer of flash.timers) clearTimeout(timer);
        flashes.delete(id);
    }
    function startFlash(entry, render, duration, fades = []) {
        if (!entry || visible.get(entry.action.id) !== entry) return;
        const id = entry.action.id;
        clearFlash(id);
        const flash = { until: Date.now() + duration, render, opacity: 1, timers: [] };
        flashes.set(id, flash);
        for (const [delay, opacity] of [...fades, [duration, 0]]) {
            const timer = setTimeout(() => {
                if (flashes.get(id) !== flash || visible.get(id) !== entry) return;
                if (opacity === 0) clearFlash(id);
                else flash.opacity = opacity;
                renderOne(entry).catch(error => streamDeck.logger.error("Key feedback failed:", error?.message));
            }, delay);
            timer.unref?.();
            flash.timers.push(timer);
        }
    }
    async function sendStatus(action) {
        const selected = streamDeck.ui.action;
        if (!selected || (action && selected.id !== action.id)) return;
        const entry = visible.get(selected.id);
        if (!entry) return;
        const status = tracker.status();
        await streamDeck.ui.sendToPropertyInspector({ type: "statusUpdate", data: {
            ...status, catalog: CATALOG, artwork: ARTWORK,
            settings: entry.settings, preview: renderButton(optionsFor(entry, status)),
            ...(entry.kind === "status" ? { statusDisplays: STATUS_DISPLAYS.map(display => ({
                ...display, preview: renderButton({ ...status, kind: "status", statusDisplay: display.id }),
            })) } : {}),
        } });
    }
    async function refresh() {
        await ready;
        const results = await Promise.allSettled([...visible.values()].map(renderOne));
        for (const result of results) if (result.status === "rejected") streamDeck.logger.error("Key update failed:", result.reason?.message);
        await sendStatus();
    }
    async function guarded(action, fn, alert = false) {
        try { await ready; await fn(); }
        catch (error) {
            streamDeck.logger.error("Caffeine tracker:", error?.message);
            if (alert) await action?.showAlert?.().catch(() => {});
            if (streamDeck.ui.action?.id === action?.id) {
                await streamDeck.ui.sendToPropertyInspector({ type: "error", message: error?.message || "The change could not be saved." }).catch(() => {});
            }
        }
    }
    class TrackerAction extends SingletonAction {
        constructor(kind) { super(); this.kind = kind; this.manifestId = `com.teamvrotek.caffeinetracker.${kind}`; }
        async onWillAppear(ev) {
            clearFlash(ev.action.id);
            pressed.delete(ev.action.id);
            const entry = { action: ev.action, kind: this.kind, settings: normalizeActionSettings(ev.payload.settings, this.kind) };
            visible.set(ev.action.id, entry);
            await guarded(ev.action, async () => { if (visible.get(ev.action.id) === entry) await renderOne(entry); });
        }
        onWillDisappear(ev) { visible.delete(ev.action.id); pressed.delete(ev.action.id); clearFlash(ev.action.id); }
        async onDidReceiveSettings(ev) {
            const entry = visible.get(ev.action.id);
            if (!entry) return;
            entry.settings = normalizeActionSettings(ev.payload.settings, this.kind);
            clearFlash(ev.action.id);
            pressed.delete(ev.action.id);
            await guarded(ev.action, async () => { await renderOne(entry); await sendStatus(ev.action); });
        }
        async onPropertyInspectorDidAppear(ev) { await guarded(ev.action, () => sendStatus(ev.action)); }
        onKeyDown(ev) { pressed.set(ev.action.id, Date.now()); }
        async onKeyUp(ev) {
            const down = pressed.get(ev.action.id);
            pressed.delete(ev.action.id);
            // Ignore unmatched releases after a profile change or plugin restart.
            if (down === undefined) return;
            if (this.kind === "status") {
                const entry = visible.get(ev.action.id);
                if (!entry) return;
                const settings = entry.settings;
                await guarded(ev.action, async () => {
                    if (visible.get(ev.action.id) !== entry || entry.settings !== settings) return;
                    if (flashes.get(ev.action.id)?.until > Date.now()) clearFlash(ev.action.id);
                    else {
                        const alternate = STATUS_DISPLAYS.find(display => display.id === settings.statusDisplay).alternate;
                        startFlash(entry, () => renderButton({ ...optionsFor(entry), statusDisplay: alternate }), 5000);
                    }
                    await renderOne(entry);
                });
                return;
            }
            const held = Date.now() - down;
            await guarded(ev.action, async () => {
                const entry = visible.get(ev.action.id);
                const settings = entry?.settings || normalizeActionSettings(ev.payload.settings);
                if (held >= 700) {
                    const removed = await tracker.undo();
                    if (removed && entry?.settings === settings) {
                        const image = renderUndoFlash({ ...removed, dose: removed.mg });
                        startFlash(entry, () => image, 1000);
                    }
                } else {
                    await tracker.add({ ...settings, mg: settings.dose });
                    if (entry?.settings === settings) {
                        startFlash(entry, opacity => renderLoggedFlash(optionsFor(entry), opacity),
                            3000, [[2400, 0.65], [2700, 0.25]]);
                    }
                }
                await refresh();
            }, true);
        }
        async onSendToPlugin(ev) {
            const msg = ev.payload;
            if (!msg || typeof msg.type !== "string") return;
            await guarded(ev.action, async () => {
                switch (msg.type) {
                    case "getStatus": await sendStatus(ev.action); return;
                    case "saveGlobal": await tracker.preferences(msg.settings || {}); break;
                    case "addDose": await tracker.add(msg); break;
                    case "editDose": await tracker.edit(msg.id, msg.newTs); break;
                    case "deleteDose": await tracker.remove(msg.id); break;
                    case "clearDoses": await tracker.clear(); break;
                    default: return;
                }
                await refresh();
            });
        }
    }
    streamDeck.actions.registerAction(new TrackerAction("drink"));
    streamDeck.actions.registerAction(new TrackerAction("status"));
    return { refresh, sendStatus, visible };
}
