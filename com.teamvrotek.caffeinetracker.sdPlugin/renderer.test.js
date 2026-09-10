import test from "node:test";
import assert from "node:assert/strict";
import { renderButton, renderUndoFlash, renderLoggedFlash, ZONE_COLORS } from "./renderer.js";

const decode = value => Buffer.from(value.split(",", 2)[1], "base64").toString("utf8");

test("caffeine-free drinks keep zero dose and can use any artwork", () => {
    const svg = decode(renderButton({ icon: "cola-free", label: "My cola", dose: 0 }));
    assert.match(svg, />\+0 mg<\/text>/);
    assert.match(svg, /Caffeine free zero sugar cola can/);
    const changed = decode(renderButton({ icon: "green-tea", dose: 0 }));
    assert.match(changed, /Green tea cup/);
    assert.match(changed, />\+0 mg<\/text>/);
});

test("daily badge counts logged drinks without changing the configured dose", () => {
    for (const count of [0, 1, 2]) {
        const svg = decode(renderButton({ icon: "espresso", quantity: 2, dose: 128, count }));
        if (count === 0) assert.doesNotMatch(svg, /×/);
        else assert.ok(svg.includes(`>${count}×</text>`));
        assert.match(svg, />\+128 mg<\/text>/);
    }
    assert.doesNotMatch(decode(renderButton({ quantity: 9 })), /×/);
});

test("daily badge normalizes invalid counts and caps large counts", () => {
    for (const count of [-1, NaN, Infinity, 0.9]) {
        assert.doesNotMatch(decode(renderButton({ count })), /×|>99\+</);
    }
    assert.match(decode(renderButton({ count: 2.9 })), />2×<\/text>/);
    assert.match(decode(renderButton({ count: 99 })), />99×<\/text>/);
    assert.match(decode(renderButton({ count: 100 })), />99\+<\/text>/);
});

test("status color affects live reading and does not color its background", () => {
    for (const [zone, color] of Object.entries(ZONE_COLORS)) {
        const svg = decode(renderButton({ kind: "status", statusDisplay: "caffeine", mg: 124, zone }));
        assert.match(svg, /<rect width="144" height="144" fill="#101111"\/>/);
        assert.ok(svg.includes(`fill="${color}">124</tspan>`));
        assert.doesNotMatch(svg, /stroke=/);
    }
});

test("legacy status sleep settings select the same numeric layouts", () => {
    const hidden = decode(renderButton({ kind: "status", mg: 124, showSleep: false, safeTime: "11:45 PM +1d" }));
    assert.doesNotMatch(hidden, /11:45|stroke=/);
    const shown = decode(renderButton({ kind: "status", mg: 124, showSleep: true, safeTime: "11:45 PM +1d" }));
    assert.match(shown, /11:45 PM \+1d/);
    assert.match(shown, /M16 76H128/);
});

test("status display selects each mode independently of the legacy sleep setting", () => {
    for (const showSleep of [false, true]) {
        const options = { kind: "status", mg: 124, zone: "fine", safeTime: "23:45 +1d", showSleep };
        for (const statusDisplay of ["caffeine", "sleep", "combined", "face"]) {
            const svg = decode(renderButton({ ...options, statusDisplay }));
            assert.ok(svg.includes(`data-status-display="${statusDisplay}"`));
            if (statusDisplay === "caffeine" || statusDisplay === "combined") {
                assert.match(svg, /<title>Estimated caffeine: 124 mg/);
                assert.match(svg, />124<\/tspan>/);
            } else {
                assert.doesNotMatch(svg, />124<\/tspan>|>mg<\/tspan>/);
            }
            if (statusDisplay === "combined") assert.match(svg, /M16 76H128/);
            else assert.doesNotMatch(svg, /M16 76H128/);
            if (statusDisplay === "sleep") assert.match(svg, /<title>Sleep estimate: 23:45 \+1d<\/title>/);
            if (statusDisplay === "caffeine" || statusDisplay === "face") assert.doesNotMatch(svg, /23:45/);
            assert.equal(svg.includes("data-face-expression="), statusDisplay === "face");
        }
    }
});

test("missing and invalid status modes retain legacy choice and default to combined", () => {
    for (const statusDisplay of [undefined, null, "invalid", "__proto__", 0, {}]) {
        const render = showSleep => decode(renderButton({ kind: "status", statusDisplay, showSleep }));
        assert.match(render(false), /data-status-display="caffeine"/);
        for (const showSleep of [undefined, null, true, "false", 0]) {
            assert.match(render(showSleep), /data-status-display="combined"/);
        }
    }
});

test("sleep-only display keeps the clock large and separates period and day offsets", () => {
    const variants = [
        [null, "Now", ""],
        ["23:45", "23:45", ""],
        ["01:05 +1d", "01:05", "+1d"],
        ["1:05a +1d", "1:05", "AM +1d"],
        ["11:45p", "11:45", "PM"],
        ["11:45 PM +1d", "11:45", "PM +1d"],
        ["12:00 AM +2d", "12:00", "AM +2d"],
    ];
    for (const [safeTime, clock, detail] of variants) {
        const svg = decode(renderButton({ kind: "status", statusDisplay: "sleep", safeTime }));
        assert.ok(svg.includes(`<title>Sleep estimate: ${safeTime || "Now"}</title>`));
        assert.ok(svg.includes(`font-size="${detail ? 36 : 39}" font-weight="700" fill="#F5EDDE" >${clock}</text>`));
        if (detail) assert.ok(svg.includes(`font-size="18" font-weight="700" fill="#DCE1F5" >${detail}</text>`));
        assert.doesNotMatch(svg, /<tspan|data-face-expression/);
    }
});

test("face-only status uses five distinct static expressions in the existing color bands", () => {
    const drawings = new Set();
    const titles = new Set();
    for (const [zone, color] of Object.entries(ZONE_COLORS)) {
        const svg = decode(renderButton({ kind: "status", statusDisplay: "face", zone, mg: 124, safeTime: "23:45" }));
        assert.ok(svg.includes(`data-face-expression="${zone}"`));
        assert.ok(svg.includes(`<circle cx="72" cy="72" r="49" fill="${color}"/>`));
        assert.match(svg, /<rect width="144" height="144" fill="#101111"\/>/);
        assert.doesNotMatch(svg, /<text|<animate|23:45|124|<image|<rect[^>]*stroke=/);
        drawings.add(svg.match(/<g data-face-expression="[^"]+">([\s\S]*?)<\/g>/)[1].replace(/<circle cx="72" cy="72"[^>]+\/>/, ""));
        titles.add(svg.match(/<title>([^<]+)<\/title>/)[1]);
    }
    assert.equal(drawings.size, 5);
    assert.equal(titles.size, 5);
    const overloaded = decode(renderButton({ kind: "status", statusDisplay: "face", zone: "over" }));
    assert.match(overloaded, /M44 53L62 71M62 53L44 71M82 53L100 71M100 53L82 71/);
    const fallback = decode(renderButton({ kind: "status", statusDisplay: "face", zone: "__proto__" }));
    assert.match(fallback, /data-face-expression="empty"/);
    assert.match(fallback, /Caffeine status: calm/);
});

test("undo identifies the removed drink and escapes user supplied names", () => {
    const svg = decode(renderUndoFlash({ label: "Tea <&\"'", icon: "tea", dose: 47 }));
    assert.match(svg, /Black tea cup/);
    assert.match(svg, />Removed<\/text>/);
    assert.match(svg, /Tea &lt;&amp;&quot;&apos;/);
    assert.match(svg, /−47 mg/);
});

test("logged feedback preserves exact artwork and content in every drink layout", () => {
    for (const layout of ["drink", "combined"]) {
        for (const showSleep of [false, true]) {
            const options = {
                icon: "espresso", drinkId: "coffee", label: "My drink", dose: 128,
                quantity: 1, count: 2, layout, showSleep, mg: 240, zone: "high", safeTime: "03:25 +1d",
            };
            const normal = decode(renderButton(options));
            const logged = decode(renderLoggedFlash(options));
            assert.equal(logged.replace(/<g data-feedback="logged"[\s\S]*?<\/g>/, ""), normal);
            assert.match(logged, /Espresso cup and saucer/);
            assert.match(logged, />2×<\/text>/);
            assert.match(logged, />\+128 mg<\/text>/);
            assert.match(logged, /data-feedback="logged" opacity="1"/);
            assert.doesNotMatch(logged, />Logged<\/text>|>My drink<\/text>|<animate/);
        }
    }
    const caffeineFree = decode(renderLoggedFlash({ icon: "cola-free", dose: 0 }));
    assert.match(caffeineFree, /Caffeine free zero sugar cola can/);
    assert.match(caffeineFree, />\+0 mg<\/text>/);
});

test("logged feedback fades only its overlay and never appears on status keys", () => {
    const options = { icon: "green-tea", dose: 30, count: 2, showSleep: true, safeTime: "22:40" };
    const normal = renderButton(options);
    assert.doesNotMatch(decode(normal), /data-feedback="logged"/);
    assert.equal(renderLoggedFlash(options, 0), normal);
    assert.equal(renderLoggedFlash(options, -1), normal);
    for (const opacity of [1, 0.65, 0.25]) {
        const logged = decode(renderLoggedFlash(options, opacity));
        assert.match(logged, new RegExp(`data-feedback="logged" opacity="${opacity}"`));
        assert.equal(logged.replace(/<g data-feedback="logged"[\s\S]*?<\/g>/, ""), decode(normal));
    }
    assert.equal(renderLoggedFlash(options, 5), renderLoggedFlash(options, 1));
    const status = { kind: "status", mg: 124, zone: "fine", showSleep: true, safeTime: "22:40" };
    assert.equal(renderLoggedFlash(status), renderButton(status));
    assert.doesNotMatch(decode(renderLoggedFlash(status)), /data-feedback="logged"/);
});

test("unknown artwork and invalid numeric settings produce usable keys", () => {
    const svg = decode(renderButton({ icon: "../../missing", dose: NaN, quantity: Infinity }));
    assert.match(svg, /Custom drink/);
    assert.match(svg, /\+0 mg/);
    assert.doesNotMatch(svg, /NaN|Infinity|×/);
});
