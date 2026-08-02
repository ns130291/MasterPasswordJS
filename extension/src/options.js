/*
 * Copyright (C) 2026 ns130291
 *
 * This file is part of MasterPasswordJS.
 *
 * MasterPasswordJS is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * MasterPasswordJS is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with MasterPasswordJS.  If not, see <http://www.gnu.org/licenses/>.
 *
 */

"use strict";

var $ = function (id) {
    return document.getElementById(id);
};

var ALL_URLS = {origins: ["<all_urls>"]};
var settings = null;

function setMessage(text, isError) {
    var el = $("message");
    el.textContent = text || "";
    el.classList.toggle("error", !!isError);
    el.hidden = !text;
}

/*
 * The background script answers a rejected command with {error}. Reporting
 * success without looking at the answer once hid the fact that every write
 * from this page was being refused, so every call goes through here.
 */
async function sendCmd(msg) {
    var response = await browser.runtime.sendMessage(msg);
    if (!response || response.error) {
        setMessage(response && response.error
            ? "Could not save: " + response.error
            : "Could not save: the extension did not answer.", true);
        return null;
    }
    return response;
}

function typeOptions(selected) {
    var select = document.createElement("select");
    MPW.TYPES.forEach(function (type) {
        var option = document.createElement("option");
        option.value = type.id;
        option.textContent = type.label;
        select.appendChild(option);
    });
    select.value = selected;
    return select;
}

function versionOptions(selected) {
    var select = document.createElement("select");
    MPW.VERSIONS.forEach(function (version) {
        var option = document.createElement("option");
        option.value = String(version);
        option.textContent = "v" + version;
        select.appendChild(option);
    });
    select.value = String(selected);
    return select;
}

function labelled(text, control, className) {
    var wrapper = document.createElement("div");
    if (className) {
        wrapper.className = className;
    }
    var label = document.createElement("label");
    label.textContent = text;
    wrapper.appendChild(label);
    wrapper.appendChild(control);
    return wrapper;
}

function checkbox(text, checked, onChange) {
    var label = document.createElement("label");
    var input = document.createElement("input");
    input.type = "checkbox";
    input.checked = checked;
    input.addEventListener("change", function () {
        onChange(input.checked);
    });
    label.appendChild(input);
    label.append(" " + text);
    return label;
}

/* ------------------------------------------------------------- site cards */

function renderSites() {
    var container = $("sites");
    container.textContent = "";

    var keys = Object.keys(settings.sites).sort();
    if (!keys.length) {
        var empty = document.createElement("p");
        empty.className = "empty";
        empty.textContent = "No sites configured yet. Open a login page and use the " +
            "MasterPasswordJS toolbar button to add one.";
        container.appendChild(empty);
        return;
    }

    keys.forEach(function (key) {
        container.appendChild(renderSiteCard(key, Store.assign(
            Store.SITE_DEFAULTS, settings.siteDefaults, settings.sites[key])));
    });
}

function renderSiteCard(key, config) {
    var card = document.createElement("section");
    card.className = "site-card";

    var head = document.createElement("header");
    var domain = document.createElement("span");
    domain.className = "domain";
    domain.textContent = key;
    var remove = document.createElement("button");
    remove.type = "button";
    remove.className = "danger";
    remove.textContent = "Delete";
    remove.addEventListener("click", async function () {
        if (!await sendCmd({cmd: "deleteSite", key: key})) {
            return;
        }
        settings = await Store.load();
        renderSites();
        setMessage("Deleted " + key + ".");
    });
    head.appendChild(domain);
    head.appendChild(remove);
    card.appendChild(head);

    var draft = Store.assign(config);

    async function persist() {
        if (await sendCmd({cmd: "saveSite", key: key, config: draft})) {
            setMessage("Saved " + key + ".");
        }
    }

    /* As above: never make saving depend on a text field losing focus. */
    var persistTimer = null;

    function persistSoon() {
        window.clearTimeout(persistTimer);
        persistTimer = window.setTimeout(persist, 250);
    }

    function persistNow() {
        window.clearTimeout(persistTimer);
        persist();
    }

    function onEdit(field, apply) {
        field.addEventListener("input", function () {
            apply();
            persistSoon();
        });
        field.addEventListener("change", function () {
            apply();
            persistNow();
        });
    }

    var differs = document.createElement("p");
    differs.className = "hint";

    function renderDiffers() {
        var value = (draft.site || "").trim();
        differs.textContent = (value && value !== key)
            ? "Derived from " + value + " instead of " + key + "."
            : "";
    }

    var site = document.createElement("input");
    site.type = "text";
    site.value = config.site || key;
    site.spellcheck = false;
    onEdit(site, function () {
        draft.site = site.value.trim();
        renderDiffers();
    });
    card.appendChild(labelled("Domain used for the password", site));
    renderDiffers();
    card.appendChild(differs);

    var row = document.createElement("div");
    row.className = "row";

    var type = typeOptions(config.type);
    type.addEventListener("change", function () {
        draft.type = type.value;
        persist();
    });
    row.appendChild(labelled("Password type", type));

    var counter = document.createElement("input");
    counter.type = "number";
    counter.min = "1";
    counter.step = "1";
    counter.value = config.counter;
    counter.addEventListener("input", function () {
        draft.counter = Math.max(1, parseInt(counter.value, 10) || 1);
        persistSoon();
    });
    counter.addEventListener("change", function () {
        draft.counter = Math.max(1, parseInt(counter.value, 10) || 1);
        counter.value = draft.counter;
        persistNow();
    });
    row.appendChild(labelled("Counter", counter, "narrow"));

    var version = versionOptions(config.version);
    version.addEventListener("change", function () {
        draft.version = parseInt(version.value, 10);
        persist();
    });
    row.appendChild(labelled("Algorithm", version, "narrow"));
    card.appendChild(row);

    var username = document.createElement("input");
    username.type = "text";
    username.value = config.username || "";
    username.spellcheck = false;
    onEdit(username, function () {
        draft.username = username.value;
    });
    card.appendChild(labelled("User name to fill", username));

    var toggles = document.createElement("fieldset");
    toggles.className = "toggles";
    toggles.appendChild(checkbox("Use the official Master Password encoding",
        config.specCompliant, function (value) {
            draft.specCompliant = value;
            persist();
        }));
    toggles.appendChild(checkbox("Fill automatically when the page loads",
        config.autofill, function (value) {
            draft.autofill = value;
            persist();
        }));
    toggles.appendChild(checkbox("Submit the form after filling",
        config.autosubmit, function (value) {
            draft.autosubmit = value;
            persist();
        }));
    toggles.appendChild(checkbox("Hide Firefox's own password dropdown here",
        config.hideBuiltinDropdown, function (value) {
            draft.hideBuiltinDropdown = value;
            persist();
        }));
    card.appendChild(toggles);

    return card;
}

/* ---------------------------------------------------------------- general */

function fillTypeSelect() {
    MPW.TYPES.forEach(function (type) {
        var option = document.createElement("option");
        option.value = type.id;
        option.textContent = type.label;
        $("default-type").appendChild(option);
    });
}

function renderGeneral() {
    $("identity").value = settings.identityName || "";
    $("lock-timeout").value = settings.lockTimeoutMinutes;
    $("show-button").checked = !!settings.showInPageButton;

    $("default-type").value = settings.siteDefaults.type;
    $("default-counter").value = settings.siteDefaults.counter;
    $("default-version").value = String(settings.siteDefaults.version);
    $("default-spec-compliant").checked = !!settings.siteDefaults.specCompliant;
    $("default-autofill").checked = !!settings.siteDefaults.autofill;
    $("default-autosubmit").checked = !!settings.siteDefaults.autosubmit;
    $("default-hide-dropdown").checked = !!settings.siteDefaults.hideBuiltinDropdown;
}

/*
 * Saving is driven by "input" as well as "change" so that it never depends on
 * a text field losing focus: typing a name and going straight to the toolbar
 * popup used to leave the name unsaved.
 */
var saveTimer = null;

function scheduleSave() {
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(saveGeneral, 250);
}

function saveNow() {
    window.clearTimeout(saveTimer);
    saveGeneral();
}

async function saveGeneral() {
    var next = {
        identityName: $("identity").value.trim(),
        lockTimeoutMinutes: Math.max(0, parseInt($("lock-timeout").value, 10) || 0),
        showInPageButton: $("show-button").checked,
        /* Built through assign() so the key order matches what Store.load()
         * returns -- the comparison below is order sensitive. */
        siteDefaults: Store.assign(Store.SITE_DEFAULTS, {
            site: "",
            type: $("default-type").value,
            counter: Math.max(1, parseInt($("default-counter").value, 10) || 1),
            version: parseInt($("default-version").value, 10),
            specCompliant: $("default-spec-compliant").checked,
            username: "",
            autofill: $("default-autofill").checked,
            autosubmit: $("default-autosubmit").checked,
            hideBuiltinDropdown: $("default-hide-dropdown").checked
        })
    };
    /*
     * Only send what actually changed. Saving on every keystroke would
     * otherwise rewrite siteDefaults each time, and every write of it makes
     * the background script re-notify every open tab.
     */
    var patch = {};
    Object.keys(next).forEach(function (key) {
        if (JSON.stringify(next[key]) !== JSON.stringify(settings[key])) {
            patch[key] = next[key];
        }
    });
    if (!Object.keys(patch).length) {
        return;
    }

    if (!await sendCmd({cmd: "saveSettings", patch: patch})) {
        return;
    }
    settings = await Store.load();
    setMessage("Settings saved.");
}

/* ------------------------------------------------------------- permission */

async function checkPermission() {
    var granted = await browser.permissions.contains(ALL_URLS);
    $("permission-warning").hidden = granted;
}

/* ------------------------------------------------------------------ backup */

async function exportSettings() {
    var data = await browser.storage.local.get(null);
    var blob = new Blob([JSON.stringify(data, null, 2)], {type: "application/json"});
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = "masterpasswordjs-settings.json";
    link.click();
    window.setTimeout(function () {
        URL.revokeObjectURL(url);
    }, 10000);
}

async function importSettings(file) {
    var text = await file.text();
    var data;
    try {
        data = JSON.parse(text);
    } catch (e) {
        setMessage("That file is not valid JSON.", true);
        return;
    }
    if (!data || typeof data !== "object" || !data.sites) {
        setMessage("That file does not look like a MasterPasswordJS backup.", true);
        return;
    }
    if (!await sendCmd({cmd: "saveSettings", patch: data})) {
        return;
    }
    settings = await Store.load();
    renderGeneral();
    renderSites();
    setMessage("Settings imported.");
}

/* ------------------------------------------------------------------ start */

document.addEventListener("DOMContentLoaded", async function () {
    fillTypeSelect();
    settings = await Store.load();
    renderGeneral();
    renderSites();
    checkPermission();

    ["identity", "lock-timeout", "show-button", "default-type", "default-counter",
        "default-version", "default-spec-compliant", "default-autofill",
        "default-autosubmit", "default-hide-dropdown"].forEach(function (id) {
        $(id).addEventListener("input", scheduleSave);
        $(id).addEventListener("change", saveNow);
    });

    $("grant").addEventListener("click", async function () {
        var granted = await browser.permissions.request(ALL_URLS);
        if (granted) {
            setMessage("Access granted. Reload open tabs so the extension can work " +
                "on them.");
        }
        checkPermission();
    });

    $("export").addEventListener("click", exportSettings);
    $("import").addEventListener("click", function () {
        $("import-file").click();
    });
    $("import-file").addEventListener("change", function (event) {
        if (event.target.files.length) {
            importSettings(event.target.files[0]);
        }
        event.target.value = "";
    });

    browser.storage.onChanged.addListener(async function (changes, area) {
        if (area !== "local" || !changes.sites) {
            return;
        }
        settings = await Store.load();
        /*
         * Saving as you type fires this listener too. Rebuilding the cards
         * would destroy the field being edited, so leave the list alone while
         * the focus is inside one of them.
         */
        if (document.activeElement && document.activeElement.closest(".site-card")) {
            return;
        }
        renderSites();
    });
});
