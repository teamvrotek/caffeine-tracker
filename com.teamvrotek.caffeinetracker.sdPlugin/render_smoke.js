// Dev smoke test: render a few button states and write their SVG to disk
// so we can visually verify the renderer without having to load the plugin
// onto Stream Deck hardware.
//
// Run with: node render_smoke.js
// Outputs: /tmp/caffeine-preview/<name>.svg

import { renderButton, renderUndoFlash } from "./renderer.js";
import { mkdirSync, writeFileSync } from "node:fs";

const OUT_DIR = "/tmp/caffeine-preview";
mkdirSync(OUT_DIR, { recursive: true });

function decode(dataUrl) {
    const base64 = dataUrl.split(",", 2)[1];
    return Buffer.from(base64, "base64").toString("utf-8");
}

const cases = [
    { name: "01-empty",      args: { label: "Coffee",    mg: 0,   safeTime: null,    zone: "empty", count: 0 } },
    { name: "02-safe-low",   args: { label: "Coffee",    mg: 35,  safeTime: null,    zone: "safe",  count: 1 } },
    { name: "03-safe-high",  args: { label: "Coffee",    mg: 95,  safeTime: "16:28", zone: "safe",  count: 1 } },
    { name: "04-fine",       args: { label: "Coffee",    mg: 180, safeTime: "22:15", zone: "fine",  count: 2 } },
    { name: "05-high",       args: { label: "Energy",    mg: 360, safeTime: "04:12", zone: "high",  count: 3 } },
    { name: "06-over",       args: { label: "Cola",      mg: 450, safeTime: "05:40", zone: "over",  count: 5 } },
    { name: "07-long-label", args: { label: "Cold Brew", mg: 235, safeTime: "01:10", zone: "fine",  count: 2 } },
    { name: "08-4-digit",    args: { label: "DANGER",    mg: 1240, safeTime: "11:45", zone: "over", count: 12 } },
    { name: "09-undo-flash", undo: true, args: { label: "Coffee", zone: "fine" } },
    { name: "10-no-count",   args: { label: "Coffee",    mg: 95,  safeTime: "16:28", zone: "safe",  count: 0 } },
    { name: "11-big-count",  args: { label: "Coffee",    mg: 180, safeTime: "22:15", zone: "fine",  count: 99 } },
];

for (const c of cases) {
    const svg = c.undo ? renderUndoFlash(c.args) : renderButton(c.args);
    const path = `${OUT_DIR}/${c.name}.svg`;
    writeFileSync(path, decode(svg));
    console.log(`  ${path}`);
}

console.log(`\nOpen them in Finder:  open ${OUT_DIR}`);
