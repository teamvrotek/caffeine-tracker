'use strict';

let websocket = null;
let uuid = null;
let actionInfo = {};
let statusPollTimer = null;
let settings = {};
let catalog = [];
let artwork = [];
let lastStatus = null;
let editingId = null;
let pendingMutation = null;
let expandedDrinks = false;
let missedQuantity = 1;
let pendingSettings = {};
let renderedHistory = '';
const dirtyFields = new Set();
const dirtyGlobals = new Set();
const pendingGlobals = new Map();
const $ = id => document.getElementById(id);
const isStatusKey = () => String(actionInfo.action || '').endsWith('.status');
const globalFields = { bedtime: 'bedtime', timeFormat: 'time-format', halfLifeHours: 'half-life', thresholdMg: 'threshold' };
const settingFields = { dose: 'dose', label: 'label', icon: 'appearance', servingId: 'serving', showSleep: 'show-sleep' };
const statusAlternates = { caffeine: 'sleep estimate', sleep: 'caffeine', combined: 'status face', face: 'caffeine and sleep' };

function connectElgatoStreamDeckSocket(inPort, inPropertyInspectorUUID, inRegisterEvent, inInfo, inActionInfo) {
    uuid = inPropertyInspectorUUID;
    try {
        actionInfo = JSON.parse(inActionInfo);
    } catch (error) {
        showError('Stream Deck could not load this key. Select the key again to reconnect.');
        return;
    }
    settings = { ...(actionInfo.payload?.settings || {}) };
    renderKeySettings();
    if (statusPollTimer) clearInterval(statusPollTimer);
    websocket = new WebSocket('ws://127.0.0.1:' + inPort);
    websocket.onopen = () => {
        websocket.send(JSON.stringify({ event: inRegisterEvent, uuid }));
        setFooter('Connected. Loading your settings…', true);
        requestStatus();
        statusPollTimer = setInterval(requestStatus, 5000);
    };
    websocket.onmessage = event => {
        try {
            const message = JSON.parse(event.data);
            if (message.event === 'didReceiveSettings') {
                acceptSettings(message.payload?.settings);
                requestStatus();
            } else if (message.event === 'sendToPropertyInspector') {
                handlePluginMessage(message.payload);
            }
        } catch (error) {
            showError('The settings response could not be read. Select this key again if it continues.');
        }
    };
    websocket.onerror = () => showError('Could not connect to Stream Deck. Select the key again to reconnect.');
    websocket.onclose = () => {
        clearInterval(statusPollTimer);
        setFooter('Disconnected. Select this key again to reconnect.', false);
        setControlsEnabled(false);
    };
}
window.connectElgatoStreamDeckSocket = connectElgatoStreamDeckSocket;

function connected() {
    return websocket && websocket.readyState === 1;
}

function sendToPlugin(payload) {
    if (!connected()) {
        showError('Stream Deck is disconnected. Your changes have not been saved.');
        return false;
    }
    websocket.send(JSON.stringify({ event: 'sendToPlugin', context: uuid, action: actionInfo.action, payload }));
    return true;
}

function requestStatus() {
    if (connected()) sendToPlugin({ type: 'getStatus' });
}

function setFooter(message, online = connected()) {
    $('footer-text').textContent = message;
    $('connection-dot').classList.toggle('connected', Boolean(online));
}

function showError(message) {
    $('message').textContent = message;
    $('message').hidden = false;
    setFooter('Please review the message above.');
}

function clearError() {
    $('message').hidden = true;
    $('message').textContent = '';
}

function node(tag, attributes = {}, ...children) {
    const element = document.createElement(tag);
    for (const [key, value] of Object.entries(attributes)) {
        if (key === 'class') element.className = value;
        else if (key.startsWith('on') && typeof value === 'function') element.addEventListener(key.slice(2), value);
        else element.setAttribute(key, String(value));
    }
    for (const child of children) {
        if (child != null) element.append(typeof child === 'string' ? document.createTextNode(child) : child);
    }
    return element;
}

function iconPath(icon) {
    const id = typeof icon === 'string' && /^[a-z0-9-]+$/.test(icon) ? icon : 'custom';
    return '../imgs/drinks/' + id + '.svg';
}

function knownDrink(id = settings.drinkId) {
    return catalog.find(drink => drink.id === id);
}

function knownServing(drink = knownDrink(), id = settings.servingId) {
    return drink?.servings?.find(serving => serving.id === id);
}

function sameValue(a, b) {
    return String(a) === String(b);
}

function acceptSettings(incoming) {
    if (!incoming || typeof incoming !== 'object') return;
    for (const [key, value] of Object.entries(pendingSettings)) {
        if (sameValue(incoming[key], value)) delete pendingSettings[key];
    }
    settings = { ...settings, ...incoming, ...pendingSettings };
    renderKeySettings();
}

function setControl(id, value, dirty = false) {
    const input = $(id);
    if (dirty || document.activeElement === input) return;
    if (input.type === 'checkbox') input.checked = Boolean(value);
    else if (value != null) input.value = String(value);
}

function setControlsEnabled(enabled) {
    document.querySelectorAll('#panel-key input, #panel-key select, #panel-key button, #panel-sleep input, #panel-sleep select').forEach(input => {
        input.disabled = !enabled;
    });
    updateMutationControls();
}

function visibleCatalog() {
    const favorites = ['coffee', 'espresso', 'energy', 'cola', 'tea', 'custom'];
    return [...catalog].sort((a, b) => {
        const aIndex = favorites.indexOf(a.id);
        const bIndex = favorites.indexOf(b.id);
        return (aIndex < 0 ? favorites.length : aIndex) - (bIndex < 0 ? favorites.length : bIndex);
    });
}

function renderCatalog() {
    const drinks = visibleCatalog();
    const container = $('presets');
    const activeIndex = drinks.findIndex(drink => drink.id === settings.drinkId);
    container.replaceChildren(...drinks.map((drink, index) => {
        const input = node('input', { type: 'radio', name: 'drink', value: drink.id, 'data-drink': drink.id, onchange: () => selectDrink(drink.id) });
        input.checked = drink.id === settings.drinkId;
        input.disabled = !connected();
        const choice = node('label', { class: 'preset' }, input,
            node('img', { src: iconPath(drink.icon), width: 36, height: 36, alt: '' }), node('span', {}, drink.name));
        choice.hidden = !expandedDrinks && index >= 6 && index !== activeIndex;
        return choice;
    }));
    $('catalog-loading').hidden = catalog.length > 0;
    $('more-drinks').hidden = catalog.length <= 6;
    $('more-drinks').textContent = expandedDrinks ? 'Fewer drinks' : 'More drinks';
    $('more-drinks').setAttribute('aria-expanded', String(expandedDrinks));
}

function renderArtwork() {
    const options = artwork.length ? artwork : catalog.map(drink => ({ id: drink.icon, name: drink.name }));
    const unique = options.filter((item, index) => options.findIndex(other => other.id === item.id) === index);
    $('appearance').replaceChildren(...unique.map(item => node('option', { value: item.id }, item.name)));
    if (settings.icon && !unique.some(item => item.id === settings.icon)) {
        $('appearance').append(node('option', { value: settings.icon }, 'Current artwork'));
    }
    $('appearance').value = settings.icon || knownDrink()?.icon || 'custom';
    $('appearance-preview').src = iconPath($('appearance').value);
    $('appearance-preview').hidden = false;
}

function renderServingOptions() {
    const select = $('serving');
    const drink = knownDrink();
    const servings = Array.isArray(drink?.servings) ? drink.servings : [];
    const signature = JSON.stringify([drink?.id, servings]);
    const matched = servings.find(serving => serving.id === settings.servingId);
    if (select.dataset.signature !== signature || (!matched && !select.querySelector('[value="custom"]'))) {
        select.replaceChildren(...servings.map(serving => node('option', { value: serving.id }, serving.label)));
        if (!servings.some(serving => serving.id === 'custom')) select.append(node('option', { value: 'custom' }, 'Custom amount'));
        select.dataset.signature = signature;
    }
    setControl('serving', matched ? matched.id : 'custom', dirtyFields.has('servingId'));
}

function renderKeySettings() {
    const statusOnly = isStatusKey();
    $('drink-settings').hidden = statusOnly;
    $('status-settings').hidden = !statusOnly;
    $('show-sleep-field').hidden = statusOnly;
    $('gesture-note').hidden = statusOnly;
    $('preview-title').textContent = statusOnly ? 'Caffeine status' : settings.label || knownDrink()?.name || 'This key';
    $('preview-description').textContent = statusOnly ? 'Your total, at a glance' : Number.isFinite(Number(settings.dose)) ? 'One press adds ' + settings.dose + ' mg' : 'Choose your drink';
    for (const [key, id] of Object.entries(settingFields)) {
        if (key !== 'servingId' && key !== 'icon') setControl(id, settings[key], dirtyFields.has(key));
    }
    renderServingOptions();
    if (!dirtyFields.has('icon')) {
        setControl('appearance', settings.icon);
        $('appearance-preview').src = iconPath(settings.icon);
    }
    const drinks = visibleCatalog();
    document.querySelectorAll('[data-drink]').forEach(input => {
        input.checked = input.dataset.drink === settings.drinkId;
        const index = drinks.findIndex(drink => drink.id === input.dataset.drink);
        input.closest('.preset').hidden = !expandedDrinks && index >= 6 && input.dataset.drink !== settings.drinkId;
    });
    document.querySelectorAll('[data-layout]').forEach(input => input.checked = input.dataset.layout === (settings.layout || 'drink'));
    if (statusOnly) renderStatusDisplays(lastStatus);
    $('layout-note').textContent = statusOnly
        ? 'All your drink keys contribute to this total.'
        : settings.layout === 'combined'
            ? 'Show your drink and current caffeine total together.'
            : 'Keep your total on a separate status key.';
    if (!statusOnly) $('layout-note').textContent += ' The badge counts today\'s drinks.';
    if (lastStatus) renderLiveStatus(lastStatus);
}

function statusDisplay() {
    return Object.hasOwn(statusAlternates, settings.statusDisplay) ? settings.statusDisplay : settings.showSleep === false ? 'caffeine' : 'combined';
}

function previewSource(preview) {
    return preview.startsWith('data:image/svg+xml') ? preview : 'data:image/svg+xml;base64,' + preview;
}

function renderStatusDisplays(data) {
    const selected = statusDisplay();
    const displays = Array.isArray(data?.statusDisplays) ? data.statusDisplays : [];
    document.querySelectorAll('[data-status-display]').forEach(input => {
        input.checked = input.dataset.statusDisplay === selected;
        const display = displays.find(item => item.id === input.dataset.statusDisplay);
        if (typeof display?.preview !== 'string' || !display.preview) return;
        const image = $('status-preview-' + input.dataset.statusDisplay);
        const source = previewSource(display.preview);
        if (image.getAttribute('src') !== source) image.src = source;
        image.hidden = false;
    });
    const alternate = displays.find(item => item.id === selected)?.alternateName || statusAlternates[selected];
    const note = 'Press to show ' + alternate + ' for five seconds. Press again to return.';
    if ($('status-display-note').textContent !== note) $('status-display-note').textContent = note;
}

function renderLiveStatus(data) {
    if (typeof data.preview === 'string' && data.preview) {
        const source = previewSource(data.preview);
        if ($('key-preview').getAttribute('src') !== source) $('key-preview').src = source;
        $('key-preview').hidden = false;
        $('preview-loading').hidden = true;
    }
    if (isStatusKey()) renderStatusDisplays(data);
    const mg = Number(data.mg);
    $('preview-detail').textContent = Number.isFinite(mg) ? Math.round(mg) + ' mg remaining now' : '';
    $('bedtime-mg').textContent = Number.isFinite(Number(data.bedtimeMg)) ? Math.round(Number(data.bedtimeMg)) + ' mg' : '…';
    $('sleep-estimate').textContent = data.safeTime || 'Now';
    const globalDraft = dirtyGlobals.size > 0 || pendingGlobals.size > 0;
    if (globalDraft) $('bedtime-mg').textContent += ' (saved settings)';
}

function saveKey(patch) {
    if (!connected()) return showError('Stream Deck is disconnected. Your changes have not been saved.');
    clearError();
    settings = { ...settings, ...patch };
    pendingSettings = { ...pendingSettings, ...patch };
    Object.keys(patch).forEach(key => dirtyFields.delete(key));
    websocket.send(JSON.stringify({ event: 'setSettings', context: uuid, payload: settings }));
    setFooter('Saving this key…');
    renderKeySettings();
    requestStatus();
}

function selectDrink(id) {
    const drink = knownDrink(id);
    const serving = drink?.servings?.[0];
    if (!drink || !serving) return showError('This drink has no serving configured. Choose another drink.');
    saveKey({ drinkId: drink.id, icon: drink.icon, label: serving.name || drink.name, dose: serving.dose, quantity: serving.quantity || 1, servingId: serving.id });
    renderArtwork();
}

function handlePluginMessage(payload) {
    if (!payload) return;
    if (payload.type === 'error') {
        showError(payload.message || 'This change could not be saved. Please try again.');
        pendingMutation = null;
        updateMutationControls();
        return;
    }
    if (payload.type !== 'statusUpdate' || !payload.data) return;
    const data = payload.data;
    lastStatus = data;
    if (Array.isArray(data.catalog) && JSON.stringify(data.catalog) !== JSON.stringify(catalog)) {
        catalog = data.catalog;
        renderCatalog();
        renderArtwork();
    }
    if (Array.isArray(data.artwork) && JSON.stringify(data.artwork) !== JSON.stringify(artwork)) {
        artwork = data.artwork;
        renderArtwork();
    }
    acceptSettings(data.settings);
    for (const [key, id] of Object.entries(globalFields)) {
        if (pendingGlobals.has(key) && sameValue(data[key], pendingGlobals.get(key))) {
            pendingGlobals.delete(key);
            dirtyGlobals.delete(key);
        }
        setControl(id, data[key], dirtyGlobals.has(key));
    }
    renderLiveStatus(data);
    const doses = Array.isArray(data.doses) ? data.doses : [];
    const historyChanged = acknowledgeMutation(doses);
    const editedDrinkMissing = editingId != null && !doses.some(dose => dose.id === editingId);
    if (editedDrinkMissing) {
        if (pendingMutation?.type === 'editDose' && pendingMutation.id === editingId) pendingMutation = null;
        editingId = null;
        showError('That drink is no longer in your history.');
    }
    if (historyChanged || editedDrinkMissing || (editingId == null && !$('history-list').contains(document.activeElement) && historySignature(doses) !== renderedHistory)) renderHistory(doses);
    $('history-count').textContent = doses.length + ' logged';
    setControlsEnabled(true);
    if ($('message').hidden && !pendingMutation && !Object.keys(pendingSettings).length && !pendingGlobals.size) setFooter('Changes save automatically');
}

function localDateTime(ts) {
    const date = new Date(ts);
    const pad = value => String(value).padStart(2, '0');
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + 'T' + pad(date.getHours()) + ':' + pad(date.getMinutes());
}

function dateTimeLabel(ts) {
    const date = new Date(ts);
    const sameYear = date.getFullYear() === new Date().getFullYear();
    return date.toLocaleString(undefined, { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }), hour: 'numeric', minute: '2-digit', hour12: lastStatus?.timeFormat === '12' });
}

function validDateTime(input) {
    const ts = new Date(input.value).getTime();
    if (!input.value || !Number.isFinite(ts)) {
        showError('Choose a valid date and time.');
        input.focus();
        return null;
    }
    if (ts > Date.now()) {
        showError('Choose a time in the past to log a drink.');
        input.focus();
        return null;
    }
    return ts;
}

function historySignature(doses) {
    return JSON.stringify([lastStatus?.timeFormat, new Date().getFullYear(), doses.map(dose =>
        [dose.id, dose.ts, dose.label, dose.mg, dose.icon, dose.drinkId, Math.round(Number(dose.residualMg) || 0)])]);
}

function renderHistory(doses) {
    renderedHistory = historySignature(doses);
    const list = $('history-list');
    if (!doses.length) {
        list.replaceChildren(node('p', { class: 'empty' }, 'No drinks logged yet. Press a drink key or add a missed drink below.'));
        return;
    }
    list.replaceChildren(...[...doses].sort((a, b) => b.ts - a.ts).map(dose => {
        const editButton = node('button', { type: 'button', class: 'plain-button', 'aria-label': 'Edit time for ' + dose.label, onclick: () => openHistoryEdit(dose) }, 'Edit');
        const deleteButton = node('button', { type: 'button', class: 'plain-button delete-button', title: 'Delete drink', 'aria-label': 'Delete ' + dose.label + ' from ' + dateTimeLabel(dose.ts), onclick: () => mutate({ type: 'deleteDose', id: dose.id }) }, '×');
        const summary = node('div', { class: 'entry-summary' },
            node('img', { class: 'entry-icon', src: iconPath(dose.icon || knownDrink(dose.drinkId)?.icon), width: 29, height: 29, alt: '' }),
            node('div', { class: 'entry-copy' },
                node('div', { class: 'entry-title' }, (dose.label || 'Drink') + ' · ' + dose.mg + ' mg'),
                node('div', { class: 'entry-subtitle' }, dateTimeLabel(dose.ts)),
                node('div', { class: 'entry-residual' }, Math.round(Number(dose.residualMg) || 0) + ' mg remaining')),
            node('div', { class: 'entry-actions' }, editButton, deleteButton));
        const row = node('div', { class: 'entry', 'data-dose-id': dose.id }, summary);
        return row;
    }));
    updateMutationControls();
}

function openHistoryEdit(dose) {
    if (pendingMutation || !connected()) return;
    editingId = null;
    renderHistory(lastStatus?.doses || []);
    editingId = dose.id;
    const row = [...$('history-list').children].find(entry => entry.dataset.doseId === String(dose.id));
    if (!row) return;
    const input = node('input', { type: 'datetime-local', step: 60, value: localDateTime(dose.ts), required: '', 'aria-label': 'Date and time for ' + dose.label });
    const cancel = node('button', { class: 'button', type: 'button', onclick: () => { editingId = null; clearError(); renderHistory(lastStatus?.doses || []); } }, 'Cancel');
    const save = node('button', { class: 'button primary', type: 'submit' }, 'Save');
    const form = node('form', { class: 'edit-form', onsubmit: event => {
        event.preventDefault();
        const ts = validDateTime(input);
        if (ts != null) mutate({ type: 'editDose', id: dose.id, newTs: ts });
    } }, node('label', { class: 'field' }, node('span', {}, 'Date and time'), input), node('div', { class: 'form-actions' }, cancel, save));
    row.append(form);
    input.focus();
}

function mutate(payload) {
    if (pendingMutation) return;
    clearError();
    pendingMutation = payload;
    if (!sendToPlugin(payload)) pendingMutation = null;
    else setFooter('Saving your history…');
    updateMutationControls();
}

function updateMutationControls() {
    const disabled = !connected() || Boolean(pendingMutation);
    document.querySelectorAll('#history-list button, #history-list input, #missed-form button, #missed-form input, #missed-form select').forEach(input => input.disabled = disabled);
    $('add-missed').disabled = disabled || !catalog.length;
}

function acknowledgeMutation(doses) {
    if (!pendingMutation) return;
    const pending = pendingMutation;
    const acknowledged = pending.type === 'deleteDose' ? !doses.some(dose => dose.id === pending.id)
        : pending.type === 'editDose' ? doses.some(dose => dose.id === pending.id && Number(dose.ts) === pending.newTs)
        : doses.some(dose => Number(dose.ts) === pending.ts && Number(dose.mg) === pending.mg && dose.label === pending.label);
    if (!acknowledged) return;
    if (pending.type === 'editDose') editingId = null;
    if (pending.type === 'addDose') closeMissedForm();
    pendingMutation = null;
    updateMutationControls();
    clearError();
    setFooter(pending.type === 'deleteDose' ? 'Drink removed' : 'History saved');
    return true;
}

function openMissedForm() {
    clearError();
    $('missed-drink').replaceChildren(...catalog.map(drink => node('option', { value: drink.id }, drink.name)));
    const drink = knownDrink() || catalog[0];
    if (!drink) return;
    $('missed-drink').value = drink.id;
    fillMissedServings(drink, settings.servingId);
    $('missed-dose').value = settings.dose ?? drink.servings[0]?.dose ?? '';
    $('missed-label').value = settings.label || drink.name;
    missedQuantity = settings.quantity || 1;
    $('missed-time').value = localDateTime(Date.now());
    $('missed-form').hidden = false;
    $('add-missed').hidden = true;
    $('add-missed').setAttribute('aria-expanded', 'true');
    $('missed-drink').focus();
}

function closeMissedForm() {
    $('missed-form').hidden = true;
    $('add-missed').hidden = false;
    $('add-missed').setAttribute('aria-expanded', 'false');
}

function fillMissedServings(drink, servingId) {
    const servings = drink.servings || [];
    $('missed-serving').replaceChildren(...servings.map(serving => node('option', { value: serving.id }, serving.label)));
    if (servings.some(serving => serving.id === servingId)) $('missed-serving').value = servingId;
    const serving = servings.find(item => item.id === $('missed-serving').value) || servings[0];
    missedQuantity = serving?.quantity || 1;
    $('missed-dose').value = serving?.dose ?? '';
    $('missed-label').value = serving?.name || drink.name;
}

function saveGlobal(key) {
    const input = $(globalFields[key]);
    if (!input.checkValidity()) {
        input.reportValidity();
        return;
    }
    const value = key === 'halfLifeHours' || key === 'thresholdMg' ? Number(input.value) : input.value;
    if (!connected()) return showError('Stream Deck is disconnected. Your changes have not been saved.');
    clearError();
    pendingGlobals.set(key, value);
    if (sendToPlugin({ type: 'saveGlobal', settings: { [key]: value } })) setFooter('Saving shared settings…');
}

function activateTab(name, focus = false) {
    for (const tabName of ['key', 'history', 'sleep']) {
        const active = tabName === name;
        $('tab-' + tabName).setAttribute('aria-selected', String(active));
        $('tab-' + tabName).tabIndex = active ? 0 : -1;
        $('panel-' + tabName).hidden = !active;
    }
    if (focus) $('tab-' + name).focus();
}

function initialize() {
    const tabs = ['key', 'history', 'sleep'];
    tabs.forEach((name, index) => {
        $('tab-' + name).addEventListener('click', () => activateTab(name));
        $('tab-' + name).addEventListener('keydown', event => {
            let next;
            if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
            else if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
            else if (event.key === 'Home') next = 0;
            else if (event.key === 'End') next = tabs.length - 1;
            else return;
            event.preventDefault();
            activateTab(tabs[next], true);
        });
    });
    $('more-drinks').addEventListener('click', () => { expandedDrinks = !expandedDrinks; renderCatalog(); });
    for (const key of ['label', 'dose']) {
        $(key).addEventListener('input', () => dirtyFields.add(key));
        $(key).addEventListener('change', () => {
            if (!$(key).checkValidity()) return $(key).reportValidity();
            if (key === 'label') {
                const label = $(key).value.trim();
                if (!label) return showError('Give this drink a name for your history.');
                saveKey({ label });
            } else {
                if ($(key).value === '') return showError('Enter caffeine between 0 and 500 mg.');
                saveKey({ dose: Number($(key).value), servingId: 'custom' });
            }
        });
    }
    $('serving').addEventListener('change', () => {
        const serving = knownServing(knownDrink(), $('serving').value);
        if (!serving) return saveKey({ servingId: 'custom' });
        saveKey({ servingId: serving.id, dose: serving.dose, quantity: serving.quantity || 1, label: serving.name || knownDrink().name });
    });
    $('appearance').addEventListener('change', () => saveKey({ icon: $('appearance').value }));
    document.querySelectorAll('[data-layout]').forEach(input => input.addEventListener('change', () => saveKey({ layout: input.dataset.layout })));
    document.querySelectorAll('[data-status-display]').forEach(input => input.addEventListener('change', () => saveKey({ statusDisplay: input.dataset.statusDisplay })));
    $('show-sleep').addEventListener('change', () => saveKey({ showSleep: $('show-sleep').checked }));
    for (const [key, id] of Object.entries(globalFields)) {
        $(id).addEventListener('input', () => { dirtyGlobals.add(key); if (lastStatus) renderLiveStatus(lastStatus); });
        $(id).addEventListener('change', () => { dirtyGlobals.add(key); saveGlobal(key); });
    }
    $('add-missed').addEventListener('click', openMissedForm);
    $('cancel-missed').addEventListener('click', () => { if (!pendingMutation) { closeMissedForm(); clearError(); } });
    $('missed-drink').addEventListener('change', () => fillMissedServings(knownDrink($('missed-drink').value)));
    $('missed-serving').addEventListener('change', () => fillMissedServings(knownDrink($('missed-drink').value), $('missed-serving').value));
    document.querySelectorAll('[data-day]').forEach(button => button.addEventListener('click', () => {
        const current = new Date($('missed-time').value);
        const date = new Date();
        date.setDate(date.getDate() - Number(button.dataset.day));
        if (Number.isFinite(current.getTime())) date.setHours(current.getHours(), current.getMinutes(), 0, 0);
        $('missed-time').value = localDateTime(date.getTime());
    }));
    $('missed-form').addEventListener('submit', event => {
        event.preventDefault();
        const ts = validDateTime($('missed-time'));
        if (ts == null) return;
        const drink = knownDrink($('missed-drink').value);
        const label = $('missed-label').value.trim();
        if (!label) return showError('Give this drink a name for your history.');
        mutate({ type: 'addDose', mg: Number($('missed-dose').value), label, ts, drinkId: drink.id, icon: drink.id === settings.drinkId ? settings.icon : drink.icon, quantity: missedQuantity });
    });
}

initialize();
