// Presets are starting estimates. The amount per press always remains editable.
const serving = (id, label, dose, quantity = 1) => ({ id, label, dose, quantity });
export const CATALOG = [
    { id: "coffee", name: "Coffee", icon: "coffee", servings: [serving("mug", "1 mug · 240 ml", 95), serving("large", "Large mug · 355 ml", 140), serving("two", "2 mugs · 480 ml", 190, 2)] },
    { id: "espresso", name: "Espresso", icon: "espresso", servings: [serving("single", "Single shot · 30 ml", 64), serving("double", "Double shot · 60 ml", 128, 2)] },
    { id: "latte", name: "Latte", icon: "latte", servings: [serving("regular", "Regular · 2 shots", 150, 2)] },
    { id: "cappuccino", name: "Cappuccino", icon: "cappuccino", servings: [serving("single", "1 espresso shot", 64), serving("double", "2 espresso shots", 128, 2)] },
    { id: "flat-white", name: "Flat white", icon: "flat-white", servings: [serving("double", "2 espresso shots", 128, 2)] },
    { id: "energy", name: "Red Bull", icon: "energy", servings: [serving("250", "1 can · 250 ml", 80), serving("355", "1 can · 355 ml", 110)] },
    { id: "cola", name: "Coke", icon: "cola", servings: [serving("355", "1 can · 355 ml", 34)] },
    { id: "cola-zero", name: "Coke Zero", icon: "cola-zero", servings: [serving("355", "1 can · 355 ml", 34)] },
    { id: "diet-cola", name: "Diet Coke", icon: "diet-cola", servings: [serving("355", "1 can · 355 ml", 46)] },
    { id: "cola-free", name: "Coke Zero-Zero", icon: "cola-free", servings: [serving("330", "Caffeine-free · 330 ml", 0)] },
    { id: "pepsi", name: "Pepsi", icon: "pepsi", servings: [serving("355", "1 can · 355 ml", 38)] },
    { id: "tea", name: "Black tea", icon: "tea", servings: [serving("cup", "1 cup · 240 ml", 47), serving("two", "2 cups · 480 ml", 94, 2)] },
    { id: "green-tea", name: "Green tea", icon: "green-tea", servings: [serving("cup", "1 cup · 240 ml", 30), serving("two", "2 cups · 480 ml", 60, 2)] },
    { id: "cold-brew", name: "Cold brew", icon: "latte", servings: [serving("355", "1 glass · 355 ml", 205)] },
    { id: "matcha", name: "Matcha", icon: "matcha", servings: [serving("regular", "1 serving · 2 g", 70)] },
    { id: "monster", name: "Monster", icon: "energy", servings: [serving("473", "1 can · 473 ml", 160)] },
    { id: "celsius", name: "Celsius", icon: "energy", servings: [serving("355", "1 can · 355 ml", 200)] },
    { id: "starbucks", name: "Starbucks", icon: "coffee", servings: [serving("pike", "Pike Place · 473 ml", 310)] },
    { id: "preworkout", name: "Pre-Wkt", icon: "preworkout", servings: [serving("scoop", "1 scoop", 200)] },
    { id: "custom", name: "Custom", icon: "custom", servings: [serving("custom", "1 serving", 95)] },
];

const ICONS = new Set(CATALOG.map(drink => drink.icon));
export const ARTWORK = [...ICONS].map(id => ({ id, name: CATALOG.find(drink => drink.icon === id).name }));
export const STATUS_DISPLAYS = Object.freeze([
    { id: "caffeine", name: "Caffeine", alternate: "sleep", alternateName: "sleep estimate" },
    { id: "sleep", name: "Sleep estimate", alternate: "caffeine", alternateName: "caffeine" },
    { id: "combined", name: "Caffeine + sleep", alternate: "face", alternateName: "status face" },
    { id: "face", name: "Status face", alternate: "combined", alternateName: "caffeine and sleep" },
].map(Object.freeze));

export function resolveStatusDisplay(raw = {}) {
    return STATUS_DISPLAYS.some(display => display.id === raw.statusDisplay)
        ? raw.statusDisplay : raw.showSleep === false ? "caffeine" : "combined";
}

export function clampNumber(value, min, max, fallback) {
    if (value === "" || value == null) return fallback;
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

export function normalizeActionSettings(raw = {}, kind = "drink") {
    raw = raw && typeof raw === "object" ? raw : {};
    const oldLabel = typeof raw.label === "string" ? raw.label.trim() : "";
    const drink = CATALOG.find(item => item.id === raw.drinkId)
        || CATALOG.find(item => item.name.toLowerCase() === oldLabel.toLowerCase())
        || CATALOG.find(item => item.id === (oldLabel ? "custom" : "coffee"));
    const dose = Math.round(clampNumber(raw.dose, 0, 500, drink.servings[0].dose));
    const selected = drink.servings.find(item => item.id === raw.servingId)
        || drink.servings.find(item => item.dose === dose);
    return {
        drinkId: drink.id,
        icon: ICONS.has(raw.icon) ? raw.icon : drink.icon,
        label: (oldLabel || drink.name).slice(0, 36),
        dose,
        quantity: Math.round(clampNumber(raw.quantity, 1, 9, 1)),
        servingId: raw.servingId === "custom" ? "custom" : selected?.id || "custom",
        layout: raw.layout === "combined" ? "combined" : "drink",
        showSleep: typeof raw.showSleep === "boolean" ? raw.showSleep : kind === "status",
        ...(kind === "status" ? { statusDisplay: resolveStatusDisplay(raw) } : {}),
    };
}

export function normalizePreferences(raw = {}, previous = {}) {
    const values = { ...previous, ...raw };
    return {
        halfLifeHours: clampNumber(values.halfLifeHours, 3, 8, 5),
        thresholdMg: Math.round(clampNumber(values.thresholdMg, 25, 100, 50)),
        bedtime: /^([01]\d|2[0-3]):[0-5]\d$/.test(values.bedtime) ? values.bedtime : "23:00",
        timeFormat: values.timeFormat === "12" ? "12" : "24",
    };
}
