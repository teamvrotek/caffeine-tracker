import streamDeck, { SingletonAction } from "@elgato/streamdeck";
import { createTracker } from "./tracker.js";
import { registerActions } from "./controller.js";

const tracker = createTracker({ save: settings => streamDeck.settings.setGlobalSettings(settings) });
let resolveReady, rejectReady;
const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
ready.catch(() => {});
const controller = registerActions(streamDeck, SingletonAction, tracker, ready);
let initialized = false;
streamDeck.settings.onDidReceiveGlobalSettings(ev => {
    if (!initialized) return;
    tracker.replace(ev.settings).then(controller.refresh).catch(error => streamDeck.logger.error("Settings update failed:", error.message));
});
await streamDeck.connect();
try {
    await tracker.replace(await streamDeck.settings.getGlobalSettings());
    initialized = true;
    resolveReady();
    await controller.refresh();
} catch (error) {
    streamDeck.logger.error("History could not be loaded:", error.message);
    rejectReady(new Error("Caffeine history could not be loaded. Restart the plugin before logging a drink."));
}
setInterval(async () => {
    try {
        await ready;
        await tracker.prune();
        await controller.refresh();
    } catch (error) { streamDeck.logger.error("Caffeine refresh failed:", error.message); }
}, 60_000);
