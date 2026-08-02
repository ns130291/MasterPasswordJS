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
var activeTab = null;
var state = null;
var saveKey = null;
var regenerateTimer = null;

function send(msg) {
    return browser.runtime.sendMessage(msg);
}

function show(id, visible) {
    $(id).hidden = !visible;
}

function setMessage(text, isError) {
    var el = $("message");
    el.textContent = text || "";
    el.classList.toggle("error", !!isError);
    el.hidden = !text;
}

/* --------------------------------------------------------------- rendering */

function fillTypeOptions() {
    var select = $("type");
    MPW.TYPES.forEach(function (type) {
        var option = document.createElement("option");
        option.value = type.id;
        option.textContent = type.label;
        select.appendChild(option);
    });
}

function currentConfig() {
    return {
        site: $("site").value.trim(),
        counter: Math.max(1, parseInt($("counter").value, 10) || 1),
        type: $("type").value,
        version: parseInt($("version").value, 10),
        specCompliant: $("spec-compliant").checked,
        username: $("username").value,
        autofill: $("autofill").checked,
        autosubmit: $("autosubmit").checked,
        hideBuiltinDropdown: $("hide-dropdown").checked
    };
}

function renderAlternatives() {
    var box = $("alternatives");
    box.textContent = "";
    var suggestions = state.suggestions || {preferred: "", alternatives: []};
    var options = [suggestions.preferred].concat(suggestions.alternatives);

    options.forEach(function (name) {
        if (!name || name === $("site").value.trim()) {
            return;
        }
        var chip = document.createElement("button");
        chip.type = "button";
        chip.textContent = name;
        chip.title = "Use " + name + " as the site name";
        chip.addEventListener("click", function () {
            $("site").value = name;
            renderAlternatives();
            regenerate();
        });
        box.appendChild(chip);
    });
}

function renderInherited() {
    var hint = $("inherited");
    hint.textContent = "";
    hint.hidden = true;

    if (!state.configured || !state.inherited || saveKey !== state.siteKey) {
        return;
    }
    hint.hidden = false;
    hint.append("These settings are saved for " + state.siteKey + ". ");
    var button = document.createElement("button");
    button.type = "button";
    button.className = "linkish";
    button.textContent = "Use separate settings for " + state.host;
    button.addEventListener("click", function () {
        saveKey = state.host;
        $("site-key").textContent = saveKey;
        renderInherited();
        renderSiteDiffers();
        setMessage("Saving will create a separate entry for " + state.host + ".");
    });
    hint.appendChild(button);
}

/*
 * The entry is stored under the domain of the page, but the password may be
 * derived from a different one. Spell that out when the two differ, otherwise
 * a site that moved to a new address looks like a misconfiguration.
 */
function renderSiteDiffers() {
    var hint = $("site-differs");
    var site = $("site").value.trim();
    if (!site || site === saveKey) {
        hint.hidden = true;
        return;
    }
    hint.hidden = false;
    hint.textContent = "The password is derived from " + site + ", not from " +
        saveKey + ". Keep it that way if this site changed its address.";
}

function renderSite() {
    var config = state.config;
    $("site-key").textContent = state.siteKey;
    $("site").value = config.site || state.suggestions.preferred || "";
    $("counter").value = config.counter;
    $("type").value = config.type;
    $("version").value = String(config.version);
    $("spec-compliant").checked = !!config.specCompliant;
    $("username").value = config.username || "";
    $("autofill").checked = !!config.autofill;
    $("autosubmit").checked = !!config.autosubmit;
    $("hide-dropdown").checked = !!config.hideBuiltinDropdown;

    $("forget").hidden = !state.configured;
    $("save").textContent = state.configured ? "Save changes" : "Save site";

    renderAlternatives();
    renderSiteDiffers();
    renderInherited();
    regenerate();
}

async function regenerate() {
    var config = currentConfig();
    if (!config.site) {
        $("password").value = "";
        return;
    }
    var response = await send({cmd: "generate", config: config});
    if (!response || response.error) {
        $("password").value = "";
        setMessage(response ? response.error : "Could not generate the password.", true);
        return;
    }
    $("password").value = response.password;
}

function scheduleRegenerate() {
    window.clearTimeout(regenerateTimer);
    regenerateTimer = window.setTimeout(function () {
        renderAlternatives();
        renderSiteDiffers();
        regenerate();
    }, 120);
}

/* ------------------------------------------------------------------ views */

async function refresh() {
    var status = await send({cmd: "status"});
    $("identity").value = status.identityName || "";
    $("lock").hidden = !status.unlocked;

    if (!status.unlocked) {
        show("site-view", false);
        show("unsupported-view", false);
        show("unlock-view", true);
        ($("identity").value ? $("master") : $("identity")).focus();
        return;
    }

    state = await send({cmd: "pageState", tabId: activeTab ? activeTab.id : undefined});
    show("unlock-view", false);

    if (!state || state.error || !state.supported) {
        show("site-view", false);
        show("unsupported-view", true);
        /*
         * Without the website permission Firefox hides the tab URL, which looks
         * exactly like an unsupported page. Tell the two apart.
         */
        var granted = await browser.permissions.contains(ALL_URLS);
        $("grant").hidden = granted;
        $("unsupported-hint").textContent = granted
            ? "This page has no web address that a site password can be derived " +
                "from. Open a normal http(s) page."
            : "MasterPasswordJS may not access websites yet, so it cannot see " +
                "which site this is.";
        return;
    }

    saveKey = state.siteKey;
    show("unsupported-view", false);
    show("site-view", true);
    renderSite();
}

/* ----------------------------------------------------------------- events */

async function onUnlock(event) {
    event.preventDefault();
    setMessage("");
    $("unlock-button").disabled = true;
    show("deriving", true);

    var response = await send({
        cmd: "unlock",
        name: $("identity").value.trim(),
        password: $("master").value
    });

    $("master").value = "";
    $("unlock-button").disabled = false;
    show("deriving", false);

    if (!response || response.error) {
        setMessage(response ? response.error : "Unlocking failed.", true);
        $("master").focus();
        return;
    }
    await refresh();
}

async function onSave() {
    var config = currentConfig();
    if (!config.site) {
        setMessage("Please enter a site name.", true);
        return;
    }
    var response = await send({cmd: "saveSite", key: saveKey, config: config});
    if (!response || response.error) {
        setMessage(response ? response.error : "Could not save.", true);
        return;
    }
    setMessage("Saved settings for " + saveKey + ".");
    state = await send({cmd: "pageState", tabId: activeTab ? activeTab.id : undefined});
    saveKey = state.siteKey;
    $("site-key").textContent = saveKey;
    $("forget").hidden = !state.configured;
    renderInherited();
    renderSiteDiffers();
}

async function onForget() {
    var response = await send({cmd: "deleteSite", key: saveKey});
    if (!response || response.error) {
        setMessage(response ? response.error : "Could not remove the settings.", true);
        return;
    }
    setMessage("Removed the settings for " + saveKey + ".");
    await refresh();
}

async function onFill(submit) {
    if (!state.configured) {
        var saved = await send({cmd: "saveSite", key: saveKey, config: currentConfig()});
        if (!saved || saved.error) {
            setMessage("Could not save the site settings.", true);
            return;
        }
    }
    var response = await send({cmd: "fillTab", tabId: activeTab.id, submit: submit});
    if (response && response.ok) {
        window.close();
        return;
    }
    var reasons = {
        "no-form": "No login form was found on this page.",
        "no-config": "No settings are saved for this site yet.",
        "locked": "MasterPasswordJS is locked.",
        "unsupported": "This page cannot be filled."
    };
    setMessage((response && reasons[response.reason]) ||
        "Filling failed. Reload the page and try again.", true);
}

function onReveal() {
    var field = $("password");
    var hidden = field.type === "password";
    field.type = hidden ? "text" : "password";
    $("reveal").textContent = hidden ? "Hide" : "Show";
}

async function onCopy() {
    if (!$("password").value) {
        return;
    }
    await navigator.clipboard.writeText($("password").value);
    setMessage("Password copied to the clipboard.");
}

document.addEventListener("DOMContentLoaded", async function () {
    fillTypeOptions();

    $("unlock-form").addEventListener("submit", onUnlock);
    $("lock").addEventListener("click", async function () {
        var response = await send({cmd: "lock"});
        if (!response || response.error) {
            setMessage(response ? response.error : "Could not lock.", true);
        }
        await refresh();
    });
    $("site").addEventListener("input", scheduleRegenerate);
    $("counter").addEventListener("input", scheduleRegenerate);
    $("type").addEventListener("change", regenerate);
    $("version").addEventListener("change", regenerate);
    $("spec-compliant").addEventListener("change", regenerate);
    $("reveal").addEventListener("click", onReveal);
    $("copy").addEventListener("click", onCopy);
    $("save").addEventListener("click", onSave);
    $("forget").addEventListener("click", onForget);
    $("fill").addEventListener("click", function () {
        /* undefined: the site's "submit after filling" setting decides */
        onFill(undefined);
    });
    $("grant").addEventListener("click", async function () {
        if (await browser.permissions.request(ALL_URLS)) {
            await refresh();
        }
    });
    $("options").addEventListener("click", function () {
        browser.runtime.openOptionsPage();
        window.close();
    });

    var tabs = await browser.tabs.query({active: true, currentWindow: true});
    activeTab = tabs.length ? tabs[0] : null;
    await refresh();
});
