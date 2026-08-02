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

/*
 * The master keys live in storage.session: memory only, wiped when Firefox
 * closes, and unreachable from content scripts. The background page is an
 * event page and may be unloaded at any time, so nothing security relevant is
 * kept in a plain variable.
 */

"use strict";

var AUTOLOCK_ALARM = "masterpassword-autolock";
var KEYS_KEY = "masterKeys";

/* ------------------------------------------------------------------ keys */

async function getKeys() {
    var stored = await browser.storage.session.get(KEYS_KEY);
    return stored[KEYS_KEY] || null;
}

async function setKeys(keys) {
    await browser.storage.session.set({[KEYS_KEY]: keys});
}

function deriveKeys(name, password) {
    return new Promise(function (resolve, reject) {
        var worker = new Worker(browser.runtime.getURL("src/crunch.js"));
        var settled = false;
        var timer = setTimeout(function () {
            if (!settled) {
                settled = true;
                worker.terminate();
                reject(new Error("Key derivation timed out."));
            }
        }, 120000);

        worker.onmessage = function (e) {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timer);
            worker.terminate();
            if (e.data.error) {
                reject(new Error(e.data.error));
            } else {
                resolve({legacy: e.data.legacy, spec: e.data.spec});
            }
        };
        worker.onerror = function (e) {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timer);
            worker.terminate();
            reject(new Error(e.message || "Key derivation failed."));
        };

        worker.postMessage({name: name, pw: password});
    });
}

async function unlock(name, password) {
    if (!name) {
        throw new Error("Please enter your name.");
    }
    if (!password) {
        throw new Error("Please enter your master password.");
    }
    var derived = await deriveKeys(name, password);
    await setKeys({name: name, legacy: derived.legacy, spec: derived.spec});
    await Store.save({identityName: name});
    await armAutolock();
    await broadcastState();
}

async function lock() {
    await browser.storage.session.remove(KEYS_KEY);
    await browser.alarms.clear(AUTOLOCK_ALARM);
    await broadcastState();
}

async function armAutolock() {
    var settings = await Store.load();
    var minutes = Number(settings.lockTimeoutMinutes);
    await browser.alarms.clear(AUTOLOCK_ALARM);
    if (minutes > 0) {
        browser.alarms.create(AUTOLOCK_ALARM, {delayInMinutes: minutes});
    }
}

browser.alarms.onAlarm.addListener(function (alarm) {
    if (alarm.name === AUTOLOCK_ALARM) {
        lock();
    }
});

/* ------------------------------------------------------------- page state */

async function pageStateFor(url) {
    var settings = await Store.load();
    var keys = await getKeys();
    var host = Store.hostOf(url);
    var match = Store.findSite(settings, url);

    return {
        unlocked: !!keys,
        identityName: keys ? keys.name : settings.identityName,
        host: host,
        supported: !!host,
        showInPageButton: settings.showInPageButton,
        siteKey: match ? match.key : host,
        inherited: match ? match.inherited : false,
        configured: !!match,
        config: match ? match.config : Store.assign(settings.siteDefaults, {
            site: host ? Store.suggestSiteNames(host).preferred : ""
        }),
        suggestions: host ? Store.suggestSiteNames(host) : {preferred: "", alternatives: []}
    };
}

async function generateFor(config) {
    var keys = await getKeys();
    if (!keys) {
        throw new Error("Locked.");
    }
    var password = MPW.sitePassword(keys, String(config.site || "").trim(),
        config.counter, config.type, config.version, config.specCompliant);
    await armAutolock();
    return password;
}

/* --------------------------------------------------------------- toolbar */

async function updateBadge(tabId, url) {
    var state;
    try {
        state = await pageStateFor(url);
    } catch (e) {
        return;
    }
    var text = "";
    var color = "#7e7e7e";
    var title = "MasterPasswordJS";

    if (state.configured) {
        if (state.unlocked) {
            text = "●";
            color = "#2e7d32";
            title = "MasterPasswordJS – ready for " + state.config.site;
        } else {
            text = "●";
            color = "#b26500";
            title = "MasterPasswordJS – locked (" + state.config.site + ")";
        }
    } else if (!state.unlocked) {
        title = "MasterPasswordJS – locked";
    }

    try {
        await browser.action.setBadgeText({tabId: tabId, text: text});
        await browser.action.setBadgeBackgroundColor({tabId: tabId, color: color});
        await browser.action.setTitle({tabId: tabId, title: title});
    } catch (e) {
        /* tab went away */
    }
}

async function refreshActiveBadges() {
    var tabs = await browser.tabs.query({active: true});
    for (var i = 0; i < tabs.length; i++) {
        await updateBadge(tabs[i].id, tabs[i].url);
    }
}

browser.tabs.onUpdated.addListener(function (tabId, changeInfo, tab) {
    if (changeInfo.status === "loading" || changeInfo.url) {
        updateBadge(tabId, tab.url);
    }
});

browser.tabs.onActivated.addListener(async function (info) {
    try {
        var tab = await browser.tabs.get(info.tabId);
        updateBadge(tab.id, tab.url);
    } catch (e) {
        /* ignore */
    }
});

/* Tell every content script that lock state or settings changed. */
async function broadcastState() {
    await refreshActiveBadges();
    var tabs = await browser.tabs.query({});
    for (var i = 0; i < tabs.length; i++) {
        browser.tabs.sendMessage(tabs[i].id, {cmd: "stateChanged"}).catch(function () {
            /* no content script in this tab */
        });
    }
}

browser.storage.onChanged.addListener(function (changes, area) {
    if (area === "local" && (changes.sites || changes.siteDefaults || changes.showInPageButton)) {
        broadcastState();
    }
});

/* ---------------------------------------------------------------- filling */

/* Frames that reported a login form, so filling can target them directly. */
var framesWithForm = new Map();

function rememberFrame(tabId, frameId) {
    var frames = framesWithForm.get(tabId);
    if (!frames) {
        frames = new Set();
        framesWithForm.set(tabId, frames);
    }
    frames.add(frameId);
}

browser.tabs.onRemoved.addListener(function (tabId) {
    framesWithForm.delete(tabId);
});

async function credentialsFor(url, options) {
    var state = await pageStateFor(url);
    if (!state.supported) {
        return {ok: false, reason: "unsupported"};
    }
    if (!state.configured) {
        return {ok: false, reason: "no-config"};
    }
    if (!state.unlocked) {
        return {ok: false, reason: "locked"};
    }
    return {
        ok: true,
        siteKey: state.siteKey,
        username: state.config.username || "",
        password: await generateFor(state.config),
        submit: options && typeof options.submit === "boolean"
            ? options.submit
            : state.config.autosubmit
    };
}

async function sendFillToFrame(tabId, frameId, payload) {
    try {
        var result = await browser.tabs.sendMessage(tabId, {
            cmd: "fill",
            siteKey: payload.siteKey,
            username: payload.username,
            password: payload.password,
            submit: payload.submit
        }, {frameId: frameId});
        return result || null;
    } catch (e) {
        return null;
    }
}

async function fillTab(tabId, url, options) {
    var payload = await credentialsFor(url, options);
    if (!payload.ok) {
        return payload;
    }

    var targets = [0];
    var known = framesWithForm.get(tabId);
    if (known) {
        known.forEach(function (frameId) {
            if (targets.indexOf(frameId) === -1) {
                targets.push(frameId);
            }
        });
    }

    /*
     * Only these frames may receive the password: frame 0 is the frame the
     * credentials were derived from, and a frame only ends up in
     * framesWithForm after its own content script matched the same
     * configuration for its own origin. Never broadcast to all frames -- that
     * would hand the password to unrelated cross-origin iframes.
     */
    for (var i = 0; i < targets.length; i++) {
        var result = await sendFillToFrame(tabId, targets[i], payload);
        if (result && result.ok) {
            return result;
        }
    }
    return {ok: false, reason: "no-form"};
}

browser.commands.onCommand.addListener(async function (command) {
    if (command !== "fill-login") {
        return;
    }
    var tabs = await browser.tabs.query({active: true, currentWindow: true});
    if (!tabs.length) {
        return;
    }
    await fillTab(tabs[0].id, tabs[0].url, null);
});

/* --------------------------------------------------------------- messages */

/*
 * Distinguishes the popup and the options page from a content script.
 *
 * Not "sender.tab": that is set for anything living in a tab, and the options
 * page opens in one, so testing it would reject every write the options page
 * makes. Only extension pages are served from the extension's own origin.
 */
function isExtensionPage(sender) {
    return typeof sender.url === "string" &&
        sender.url.startsWith(browser.runtime.getURL(""));
}

async function handleMessage(msg, sender) {
    switch (msg.cmd) {
        case "status": {
            var keys = await getKeys();
            var settings = await Store.load();
            return {
                unlocked: !!keys,
                identityName: keys ? keys.name : settings.identityName
            };
        }

        case "unlock":
            await unlock(msg.name, msg.password);
            return {ok: true};

        case "lock":
            await lock();
            return {ok: true};

        /*
         * For a content script the URL always comes from the sender, never
         * from the message, so a compromised tab cannot ask about another
         * origin. Only the popup and the options page may name a tab.
         */
        case "pageState": {
            var url = isExtensionPage(sender)
                ? await tabUrl(msg.tabId)
                : sender.url;
            return await pageStateFor(url);
        }

        case "generate": {
            if (!isExtensionPage(sender)) {
                throw new Error("not allowed from a content script");
            }
            return {password: await generateFor(msg.config)};
        }

        case "saveSite": {
            if (!isExtensionPage(sender)) {
                throw new Error("not allowed from a content script");
            }
            await Store.putSite(msg.key, msg.config);
            await refreshActiveBadges();
            return {ok: true};
        }

        case "deleteSite": {
            if (!isExtensionPage(sender)) {
                throw new Error("not allowed from a content script");
            }
            await Store.deleteSite(msg.key);
            await refreshActiveBadges();
            return {ok: true};
        }

        case "saveSettings": {
            if (!isExtensionPage(sender)) {
                throw new Error("not allowed from a content script");
            }
            await Store.save(msg.patch);
            if (Object.prototype.hasOwnProperty.call(msg.patch, "lockTimeoutMinutes")) {
                var keys2 = await getKeys();
                if (keys2) {
                    await armAutolock();
                }
            }
            return {ok: true};
        }

        /* Content script asks for its own credentials (in-page button). */
        case "fillMe": {
            if (isExtensionPage(sender) || !sender.tab) {
                throw new Error("only content scripts");
            }
            return await credentialsFor(sender.url, {submit: msg.submit});
        }

        case "formPresent": {
            if (!isExtensionPage(sender) && sender.tab) {
                rememberFrame(sender.tab.id, sender.frameId || 0);
            }
            return {ok: true};
        }

        case "openOptions":
            await browser.runtime.openOptionsPage();
            return {ok: true};

        /* Popup asks for a tab to be filled. */
        case "fillTab": {
            if (!isExtensionPage(sender)) {
                throw new Error("not allowed from a content script");
            }
            var tab = await browser.tabs.get(msg.tabId);
            return await fillTab(tab.id, tab.url, {submit: msg.submit});
        }

        case "openPopup":
            try {
                await browser.action.openPopup();
                return {ok: true};
            } catch (e) {
                return {ok: false, reason: "unsupported"};
            }

        default:
            throw new Error("unknown command: " + msg.cmd);
    }
}

async function tabUrl(tabId) {
    if (typeof tabId !== "number") {
        var tabs = await browser.tabs.query({active: true, currentWindow: true});
        return tabs.length ? tabs[0].url : null;
    }
    var tab = await browser.tabs.get(tabId);
    return tab.url;
}

browser.runtime.onMessage.addListener(function (msg, sender) {
    return handleMessage(msg, sender).catch(function (err) {
        return {error: String(err && err.message || err)};
    });
});

browser.runtime.onInstalled.addListener(function (details) {
    if (details.reason === "install") {
        browser.runtime.openOptionsPage();
    }
});
