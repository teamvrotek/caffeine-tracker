// Duotone artwork and live key layouts. SVGs stay sharp on every key size.
import { readFileSync } from "node:fs";
import { resolveStatusDisplay } from "./config.js";

export const ZONE_COLORS = Object.freeze({
    empty: "#F5EDDE", safe: "#AFE3AA", fine: "#F9DB70", high: "#FFAA50", over: "#FF7D78",
});
const BG = "#101111";
const CREAM = "#F5EDDE";
const MUTED = "#B2ADA4";
const MOON = "#DCE1F5";
const FONT = "Arial, Helvetica, sans-serif";
const DRINK_IDS = ["coffee", "espresso", "latte", "cappuccino", "flat-white", "energy", "cola", "cola-zero", "diet-cola", "cola-free", "pepsi", "tea", "green-tea", "matcha", "preworkout", "custom"];
const ART = new Map(DRINK_IDS.map(id => {
    const source = readFileSync(new URL(`./imgs/drinks/${id}.svg`, import.meta.url), "utf8");
    return [id, source.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "")];
}));

function escapeXml(value) {
    return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;")
        .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
function amount(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.round(number)) : 0;
}
function drinkIcon(options) {
    const candidate = options.icon || options.drinkId;
    if (candidate) return ART.has(candidate) ? candidate : "custom";
    const label = String(options.label || "coffee").toLowerCase();
    if (/espresso/.test(label)) return "espresso";
    if (/cappuccino/.test(label)) return "cappuccino";
    if (/flat.?white/.test(label)) return "flat-white";
    if (/latte/.test(label)) return "latte";
    if (/energy|red bull|monster/.test(label)) return "energy";
    if (/pepsi/.test(label)) return "pepsi";
    if (/cola|coke/.test(label)) return "cola";
    if (/matcha/.test(label)) return "matcha";
    if (/green.?tea/.test(label)) return "green-tea";
    if (/tea/.test(label)) return "tea";
    if (/pre.?workout/.test(label)) return "preworkout";
    return /coffee|brew/.test(label) ? "coffee" : "custom";
}
function art(icon, x, y, size) {
    return `<g transform="translate(${x} ${y}) scale(${size / 100})">${ART.get(icon)}</g>`;
}
function text(value, x, y, size, color = CREAM, weight = 700, extra = "") {
    return `<text x="${x}" y="${y}" text-anchor="middle" font-family="${FONT}" font-size="${size}" font-weight="${weight}" fill="${color}" ${extra}>${escapeXml(value)}</text>`;
}
function frame(content, title) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144"><title>${escapeXml(title)}</title><rect width="144" height="144" fill="${BG}"/>${content}</svg>`;
    return "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64");
}
function dailyCountBadge(count) {
    const number = Number(count);
    const dailyCount = Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0;
    if (dailyCount === 0) return "";
    const value = dailyCount > 99 ? "99+" : `${dailyCount}×`;
    const width = 28;
    const x = 132 - width;
    const y = 15;
    return `<rect x="${x}" y="${y}" width="${width}" height="24" rx="12" fill="${BG}" stroke="#514D45" stroke-width="1.5"/>${text(value, x + width / 2, y + 17, value.length > 2 ? 12 : 14)}`;
}
function moon(x, y, size) {
    return `<path transform="translate(${x} ${y}) scale(${size / 24})" d="M14.2 1.1A11.5 11.5 0 1 0 23 18.7 10.1 10.1 0 0 1 14.2 1.1Z" fill="${MOON}"/>`;
}
function sleepRow(safeTime, y, compact = false) {
    const value = safeTime ? String(safeTime) : "Now";
    const size = compact ? (value.length > 9 ? 13 : 15) : (value.length > 10 ? 17 : value.length > 7 ? 19 : 23);
    const iconSize = compact ? 17 : 26;
    const width = Math.min(130, iconSize + 9 + value.length * size * 0.56);
    const left = (144 - width) / 2;
    return moon(left, y - iconSize + 3, iconSize) + text(value, left + iconSize + 9 + (width - iconSize - 9) / 2, y, size);
}
function reading(mg, zone, y, compact = false) {
    const number = amount(mg);
    const digits = String(number).length;
    const size = compact ? (digits > 3 ? 27 : 33) : (digits > 4 ? 29 : digits > 3 ? 36 : digits > 2 ? 43 : 49);
    const unit = compact ? 14 : 17;
    return `<text x="72" y="${y}" text-anchor="middle" font-family="${FONT}" font-weight="700"><tspan font-size="${size}" fill="${ZONE_COLORS[zone] || ZONE_COLORS.empty}">${number}</tspan><tspan dx="${compact ? 3 : 4}" font-size="${unit}" fill="${CREAM}">mg</tspan></text>`;
}

function sleepDisplay(safeTime) {
    const value = safeTime ? String(safeTime) : "Now";
    const parts = value.match(/^(\d{1,2}:\d{2})(?:\s*(AM|PM|a|p))?(?:\s+(\+\d+d))?$/i);
    const time = parts ? parts[1] : value;
    const period = parts?.[2] ? (parts[2].toLowerCase().startsWith("a") ? "AM" : "PM") : "";
    const detail = [period, parts?.[3]].filter(Boolean).join(" ");
    const size = time.length > 7 ? 24 : time.length > 5 ? 30 : detail ? 36 : 39;
    return moon(detail ? 51 : 49, detail ? 17 : 20, detail ? 42 : 46)
        + text(time, 72, detail ? 98 : 108, size)
        + (detail ? text(detail, 72, 125, 18, MOON) : "");
}

const FACE_EXPRESSIONS = Object.freeze({
    empty: {
        name: "Calm",
        features: `<path d="M46 64Q54 72 62 64M82 64Q90 72 98 64M61 89Q72 95 83 89" fill="none" stroke="${BG}" stroke-width="5" stroke-linecap="round"/>`,
    },
    safe: {
        name: "Happy",
        features: `<ellipse cx="54" cy="62" rx="4.5" ry="6.5" fill="${BG}"/><ellipse cx="90" cy="62" rx="4.5" ry="6.5" fill="${BG}"/><path d="M51 81H93C91 106 53 106 51 81Z" fill="${BG}"/><path d="M56 85H88Q86 91 72 91Q58 91 56 85Z" fill="${CREAM}"/>`,
    },
    fine: {
        name: "Wide awake",
        features: `<circle cx="53" cy="62" r="13" fill="${CREAM}"/><circle cx="91" cy="62" r="13" fill="${CREAM}"/><circle cx="53" cy="62" r="5.5" fill="${BG}"/><circle cx="91" cy="62" r="5.5" fill="${BG}"/><ellipse cx="72" cy="92" rx="7" ry="9" fill="${BG}"/>`,
    },
    high: {
        name: "Wired",
        features: `<path d="M41 41L60 46M83 45L100 39" fill="none" stroke="${BG}" stroke-width="4.5" stroke-linecap="round"/><circle cx="53" cy="65" r="12" fill="${CREAM}"/><ellipse cx="91" cy="64" rx="13" ry="15" fill="${CREAM}"/><circle cx="50" cy="64" r="5.5" fill="${BG}"/><circle cx="94" cy="61" r="5.5" fill="${BG}"/><path d="M51 93L59 86L67 93L75 86L83 93L91 86" fill="none" stroke="${BG}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`,
    },
    over: {
        name: "Overloaded",
        features: `<path d="M44 53L62 71M62 53L44 71M82 53L100 71M100 53L82 71" fill="none" stroke="${BG}" stroke-width="6" stroke-linecap="round"/><path d="M58 92Q72 84 86 92L82 105Q72 111 62 105Z" fill="${BG}"/><path d="M65 103Q72 97 79 103L78 105Q72 108 66 105Z" fill="${CREAM}"/>`,
    },
});

function statusFace(zone) {
    const key = Object.hasOwn(FACE_EXPRESSIONS, zone) ? zone : "empty";
    const expression = FACE_EXPRESSIONS[key];
    return {
        title: `Caffeine status: ${expression.name.toLowerCase()}`,
        content: `<g data-face-expression="${key}"><circle cx="72" cy="72" r="49" fill="${ZONE_COLORS[key]}"/>${expression.features}</g>`,
    };
}

function loggedOverlay(opacity) {
    if (opacity <= 0) return "";
    return `<g data-feedback="logged" opacity="${opacity}"><circle cx="72" cy="72" r="30.1875" fill="#3D8B58"/><path d="M60 72L68 80L85 63" fill="none" stroke="#FFFFFF" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/></g>`;
}

// The badge counts today's logged drinks. Dose always describes one key press.
function renderKey(options, loggedOpacity = 0) {
    const { kind = "drink", label = "Coffee", dose = 95, count = 0,
        layout = "drink", showSleep = false, mg = 0, safeTime = null, zone = "empty" } = options;
    if (kind === "status") {
        const display = resolveStatusDisplay(options);
        let content;
        let title = `Estimated caffeine: ${amount(mg)} mg`;
        if (display === "face") {
            ({ content, title } = statusFace(zone));
        } else if (display === "sleep") {
            content = sleepDisplay(safeTime);
            title = `Sleep estimate: ${safeTime || "Now"}`;
        } else if (display === "combined") {
            content = reading(mg, zone, 57) + `<path d="M16 76H128" stroke="#6B6B68" stroke-width="2" stroke-linecap="round"/>` + sleepRow(safeTime, 117);
            title += `; sleep estimate: ${safeTime || "Now"}`;
        } else {
            content = reading(mg, zone, 87);
        }
        return frame(`<g data-status-display="${display}">${content}</g>`, title);
    }
    const icon = drinkIcon(options);
    const combined = layout === "combined" || layout === "drink-status";
    const artTopOffset = icon === "custom" ? 3 : 0;
    let content;
    if (combined) {
        content = art(icon, showSleep ? 40 : 34, 5 + artTopOffset, showSleep ? 64 : 72) + dailyCountBadge(count)
            + text(`+${amount(dose)} mg`, 72, showSleep ? 80 : 91, 17)
            + reading(mg, zone, showSleep ? 110 : 126, true)
            + (showSleep ? sleepRow(safeTime, 130, true) : "");
    } else {
        const handleOffset = icon === "coffee" ? -6 : showSleep && ["tea", "green-tea"].includes(icon) ? -3 : 0;
        content = art(icon, (showSleep ? 26 : 16) + handleOffset, 3 + artTopOffset, showSleep ? 92 : 112)
            + dailyCountBadge(count) + text(`+${amount(dose)} mg`, 72, showSleep ? 110 : 129, amount(dose) > 999 ? 21 : 25)
            + (showSleep ? sleepRow(safeTime, 130, true) : "");
    }
    return frame(content + loggedOverlay(loggedOpacity), `${label}: add ${amount(dose)} mg`);
}

export function renderButton(options = {}) { return renderKey(options); }

// The controller supplies opacity frames. Keep every configured key element still.
export function renderLoggedFlash(options = {}, opacity = 1) {
    const value = Number(opacity);
    const visible = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 1;
    return renderKey(options, visible);
}

export function renderUndoFlash({ label = "Drink", dose = 0, icon, drinkId } = {}) {
    const value = String(label).trim() || "Drink";
    const shortLabel = value.length > 18 ? `${value.slice(0, 17)}…` : value;
    const content = art(drinkIcon({ icon, drinkId, label }), 39, 3, 66)
        + text("Removed", 72, 89, 22, CREAM)
        + text(shortLabel, 72, 111, shortLabel.length > 13 ? 13 : 16)
        + text(`−${amount(dose)} mg`, 72, 133, 18, MUTED);
    return frame(content, `Removed: ${value}, ${amount(dose)} mg`);
}
