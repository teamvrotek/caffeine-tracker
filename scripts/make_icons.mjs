#!/usr/bin/env node
// Generate the 8 Stream Deck icons from SVG sources.
//
// Outputs (all to com.teamvrotek.caffeinetracker.sdPlugin/imgs/):
//   pluginIcon.png / @2x.png           28 / 56   white coffee cup, transparent bg (B/W)
//   categoryIcon.png / @2x.png         28 / 56   same as plugin icon (dark-mode sidebar)
//   actionIcon.png / @2x.png           20 / 40   same as plugin icon (actions list)
//   actionDefaultImage.png / @2x.png   72 / 144  full color button mock (rendered via renderer.js)
//
// Requires `rsvg-convert` on PATH (brew install librsvg).

import { writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { renderButton } from "../com.teamvrotek.caffeinetracker.sdPlugin/renderer.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IMG_DIR = path.resolve(__dirname, "..", "com.teamvrotek.caffeinetracker.sdPlugin", "imgs");
const TMP_DIR = "/tmp/caffeine-icons";
mkdirSync(IMG_DIR, { recursive: true });
mkdirSync(TMP_DIR, { recursive: true });

// ------------------------------------------------------------
// Monochrome coffee-cup silhouette (cup + steam + handle).
// Used for categoryIcon + actionIcon. Stream Deck composites these
// against its dark chrome, so we keep transparent bg.
// ------------------------------------------------------------
function monoCoffeeCupSVG({ cup = "#f5f5f5", steam = "#9ca3af" } = {}) {
    // Chunky weights so the icon still reads at 20x20 pixels.
    // Cup = near-white (slightly off so it doesn't glare), steam = neutral grey
    // so it reads as dissipating vapor, not a second solid shape.
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <g fill="none" stroke="${steam}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round">
    <!-- steam (centered over the cup opening, which spans x=14..70 → center x=42) -->
    <path d="M22 26 C 18 18, 26 14, 22 4"/>
    <path d="M42 26 C 38 18, 46 14, 42 4"/>
    <path d="M62 26 C 58 18, 66 14, 62 4"/>
  </g>
  <!-- cup body -->
  <path d="M 14 38
           L 70 38
           L 70 74
           Q 70 92, 52 92
           L 32 92
           Q 14 92, 14 74
           Z"
        fill="${cup}"/>
  <!-- handle (tucked slightly into the mug so it reads as attached) -->
  <path d="M 71 48
           Q 89 48, 89 62
           Q 89 76, 71 76"
        fill="none" stroke="${cup}" stroke-width="10" stroke-linecap="round"/>
</svg>`;
}

// ------------------------------------------------------------
// Marketplace plugin icon: colored coffee-cup wrapped in a rounded square tile.
// Same pattern as Claude Peak Ticker's pluginIcon - a framed marketplace
// "chip" with a gradient background and a subtle accent border, so the plugin
// stands out when browsing the Elgato marketplace.
// ------------------------------------------------------------
function marketplacePluginIconSVG() {
    // Inner cup glyph is the same geometry as monoCoffeeCupSVG, but rendered
    // at 72% scale and tinted amber on a dark-coffee gradient tile.
    const CUP = "#fde047";      // amber, matches the "fine" zone accent
    const STEAM = "#9ca3af";    // neutral grey, reads as dissipating vapor
    const BG_START = "#2d1a0f"; // warm brown (espresso crema)
    const BG_END = "#140c06";   // dark coffee bean
    const BORDER = "#fde047";   // amber, matching the cup

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <defs>
    <radialGradient id="bg" cx="50%" cy="55%" r="75%">
      <stop offset="0%" stop-color="${BG_START}"/>
      <stop offset="100%" stop-color="${BG_END}"/>
    </radialGradient>
    <clipPath id="tile"><rect width="100" height="100" rx="18"/></clipPath>
  </defs>
  <g clip-path="url(#tile)">
    <rect width="100" height="100" fill="url(#bg)"/>
    <rect x="3" y="3" width="94" height="94" rx="15"
          fill="none" stroke="${BORDER}" stroke-opacity="0.45" stroke-width="1.8"/>
    <g transform="translate(14, 14) scale(0.72)">
      <g fill="none" stroke="${STEAM}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round">
        <path d="M22 26 C 18 18, 26 14, 22 4"/>
        <path d="M42 26 C 38 18, 46 14, 42 4"/>
        <path d="M62 26 C 58 18, 66 14, 62 4"/>
      </g>
      <path d="M 14 38 L 70 38 L 70 74 Q 70 92, 52 92 L 32 92 Q 14 92, 14 74 Z"
            fill="${CUP}"/>
      <path d="M 71 48 Q 89 48, 89 62 Q 89 76, 71 76"
            fill="none" stroke="${CUP}" stroke-width="10" stroke-linecap="round"/>
    </g>
  </g>
</svg>`;
}

// Action default image: full-color rendered button. Using the real renderer
// so the default tile on a freshly-placed button matches the plugin's actual
// output exactly. We pick a "fine" (yellow) state with a preview time.
function actionDefaultSVG() {
    // renderButton returns a data URL; strip the prefix to get raw SVG.
    const dataUrl = renderButton({
        label: "Coffee",
        mg: 95,
        safeTime: "22:05",
        zone: "safe",
        count: 1,
    });
    const base64 = dataUrl.split(",", 2)[1];
    return Buffer.from(base64, "base64").toString("utf-8");
}

function convert(svgPath, pngPath, w, h) {
    execFileSync("rsvg-convert", ["-w", String(w), "-h", String(h), svgPath, "-o", pngPath]);
}

function writeAndConvert(name, svg, w1x, w2x) {
    const svgPath = path.join(TMP_DIR, `${name}.svg`);
    writeFileSync(svgPath, svg);
    convert(svgPath, path.join(IMG_DIR, `${name}.png`), w1x, w1x);
    convert(svgPath, path.join(IMG_DIR, `${name}@2x.png`), w2x, w2x);
    console.log(`  ${name}.png (${w1x}x${w1x})  +  ${name}@2x.png (${w2x}x${w2x})`);
}

// ------------------------------------------------------------
const mono = monoCoffeeCupSVG({ cup: "#f5f5f5", steam: "#9ca3af" });
const marketplace = marketplacePluginIconSVG();
const action = actionDefaultSVG();

// pluginIcon gets the colored marketplace chip.
// categoryIcon + actionIcon stay monochrome for Stream Deck's dark UI.
writeAndConvert("pluginIcon",         marketplace, 28, 56);
writeAndConvert("categoryIcon",       mono,        28, 56);
writeAndConvert("actionIcon",         mono,        20, 40);
writeAndConvert("actionDefaultImage", action,      72, 144);

console.log(`\nWrote 8 icons to ${IMG_DIR}`);
console.log(`Source SVGs kept in ${TMP_DIR} for preview.`);
