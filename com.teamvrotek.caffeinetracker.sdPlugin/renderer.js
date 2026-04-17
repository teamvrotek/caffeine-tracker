// SVG renderer for Caffeine Tracker Stream Deck buttons.
// 144x144 Hi-DPI SVG. Returns a base64 data URL that Stream Deck displays.
//
// Layout (all text centered):
//   ┌─────────────┐  y=4   border
//   │ COFFEE ×3   │  y=26  label + count inline (tspan), centered as one unit
//   │             │
//   │     235     │  y=78  number (shrinks by digit count)
//   │     mg      │  y=96  unit
//   │             │
//   │  bed 01:10  │  y=126 safe-sleep clock (or  ✓ )
//   └─────────────┘  y=140 border

const ZONE_COLORS = {
    empty: { fill: "#0f172a", stroke: "#475569", number: "#64748b", safe: "#475569", badge: "#64748b" },
    safe:  { fill: "#052e16", stroke: "#4ade80", number: "#4ade80", safe: "#94a3b8", badge: "#86efac" },
    fine:  { fill: "#3f3f05", stroke: "#fde047", number: "#fde047", safe: "#cbd5e1", badge: "#fef08a" },
    high:  { fill: "#431407", stroke: "#fb923c", number: "#fb923c", safe: "#cbd5e1", badge: "#fdba74" },
    over:  { fill: "#450a0a", stroke: "#ef4444", number: "#ef4444", safe: "#fca5a5", badge: "#fca5a5" },
};

const FONT_FAMILY =
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

function escapeXml(str) {
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function numberFontSize(mg) {
    const str = String(mg);
    if (str.length >= 4) return 40;
    if (str.length === 3) return 48;
    return 56;
}

function labelFontSize(label) {
    const len = (label || "").length;
    if (len > 10) return 11;
    if (len > 8) return 13;
    return 15;
}

export function renderButton({ label, mg, safeTime, zone, count }) {
    const z = ZONE_COLORS[zone] || ZONE_COLORS.empty;
    const displayLabel = (label || "CAFFEINE").toString().toUpperCase();
    const number = Math.max(0, Math.round(Number(mg) || 0));
    const safeDisplay = safeTime ? `bed ${safeTime}` : "\u2713";
    const numSize = numberFontSize(number);
    const c = Math.max(0, Math.floor(Number(count) || 0));

    // Combined "COFFEE ×3" line, centered as a single unit. We size the font
    // based on the combined length so it still fits with a long drink name
    // and a big count.
    const combined = displayLabel + (c > 0 ? ` \u00d7${c}` : "");
    const labelSize = labelFontSize(combined);
    const countTspan = c > 0
        ? `<tspan fill="${z.badge}"> \u00d7${c}</tspan>`
        : "";

    const svg =
`<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144">
  <defs>
    <clipPath id="outer"><rect width="144" height="144" rx="22"/></clipPath>
  </defs>
  <g clip-path="url(#outer)">
    <rect width="144" height="144" fill="${z.fill}"/>
    <rect x="4" y="4" width="136" height="136" rx="18"
          fill="none" stroke="${z.stroke}" stroke-width="3"/>
    <text x="72" y="26" text-anchor="middle" font-weight="bold"
          font-size="${labelSize}" font-family="${FONT_FAMILY}"
          xml:space="preserve"
    ><tspan fill="#e2e8f0">${escapeXml(displayLabel)}</tspan>${countTspan}</text>
    <text x="72" y="78" text-anchor="middle"
          fill="${z.number}" font-weight="bold" font-size="${numSize}"
          font-family="${FONT_FAMILY}">${number}</text>
    <text x="72" y="96" text-anchor="middle"
          fill="#94a3b8" font-weight="bold" font-size="11"
          font-family="${FONT_FAMILY}">mg</text>
    <text x="72" y="126" text-anchor="middle"
          fill="${z.safe}" font-weight="bold" font-size="17"
          font-family="${FONT_FAMILY}">${escapeXml(safeDisplay)}</text>
  </g>
</svg>`;

    return "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64");
}

// Flash state shown briefly after a long-press undo, to confirm the action.
export function renderUndoFlash({ label, zone }) {
    const z = ZONE_COLORS[zone] || ZONE_COLORS.empty;
    const displayLabel = (label || "CAFFEINE").toString().toUpperCase();
    const labelSize = labelFontSize(displayLabel);

    const svg =
`<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144">
  <defs>
    <clipPath id="outer"><rect width="144" height="144" rx="22"/></clipPath>
  </defs>
  <g clip-path="url(#outer)">
    <rect width="144" height="144" fill="${z.fill}"/>
    <rect x="4" y="4" width="136" height="136" rx="18"
          fill="none" stroke="#fca5a5" stroke-width="4"/>
    <text x="72" y="26" text-anchor="middle"
          fill="#fca5a5" font-weight="bold" font-size="${labelSize}"
          font-family="${FONT_FAMILY}">${escapeXml(displayLabel)}</text>
    <text x="72" y="82" text-anchor="middle"
          fill="#fca5a5" font-weight="bold" font-size="34"
          font-family="${FONT_FAMILY}">UNDO</text>
    <text x="72" y="118" text-anchor="middle"
          fill="#fecaca" font-weight="bold" font-size="12"
          font-family="${FONT_FAMILY}">last dose removed</text>
  </g>
</svg>`;

    return "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64");
}
