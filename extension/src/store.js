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
 * Persisted settings (storage.local) and the mapping from a page URL to a
 * saved site configuration.
 *
 * Sites are keyed by host, with "www." stripped. Lookup walks up the domain,
 * so a configuration saved for "example.com" also covers
 * "accounts.example.com" unless that subdomain has its own entry.
 */

"use strict";

var Store = (function () {
    var IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

    var SITE_DEFAULTS = {
        /*
         * site is the domain the password is derived from. It defaults to the
         * domain the entry is stored under, but may be set to a different one
         * -- for sites that changed their address, so the password keeps being
         * derived from the domain it was originally created for.
         */
        site: "",
        counter: 1,
        type: "long",
        version: 3,
        specCompliant: false,
        username: "",
        autofill: true,
        autosubmit: false,
        hideBuiltinDropdown: true
    };

    var SETTINGS_DEFAULTS = {
        identityName: "",
        lockTimeoutMinutes: 15,
        showInPageButton: true,
        siteDefaults: SITE_DEFAULTS,
        sites: {}
    };

    function assign() {
        var out = {};
        for (var i = 0; i < arguments.length; i++) {
            var src = arguments[i] || {};
            for (var k in src) {
                if (Object.prototype.hasOwnProperty.call(src, k)) {
                    out[k] = src[k];
                }
            }
        }
        return out;
    }

    async function load() {
        var raw = await browser.storage.local.get(null);
        var settings = assign(SETTINGS_DEFAULTS, raw);
        settings.siteDefaults = assign(SITE_DEFAULTS, raw.siteDefaults);
        settings.sites = raw.sites || {};
        return settings;
    }

    async function save(patch) {
        await browser.storage.local.set(patch);
    }

    /* "https://www.Mail.Example.com/x" -> "mail.example.com", or null. */
    function hostOf(url) {
        if (!url) {
            return null;
        }
        var parsed;
        try {
            parsed = new URL(url);
        } catch (e) {
            return null;
        }
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
            return null;
        }
        var host = parsed.hostname.toLowerCase();
        if (host.indexOf("www.") === 0) {
            host = host.substring(4);
        }
        return host || null;
    }

    function isLiteralAddress(host) {
        return IPV4.test(host) || host.indexOf(":") !== -1;
    }

    /*
     * Keys that may hold a configuration for this host, most specific first:
     * "a.b.example.com" -> a.b.example.com, b.example.com, example.com
     */
    function keyCandidates(host) {
        if (!host) {
            return [];
        }
        if (isLiteralAddress(host)) {
            return [host];
        }
        var labels = host.split(".");
        var out = [];
        for (var i = 0; i + 2 <= labels.length; i++) {
            out.push(labels.slice(i).join("."));
        }
        return out.length ? out : [host];
    }

    /*
     * The site name proposed for a new entry. The web app strips everything
     * but the last two labels, so do the same here to stay compatible with
     * passwords generated there. More specific alternatives are offered as
     * one-click suggestions.
     */
    function suggestSiteNames(host) {
        var candidates = keyCandidates(host);
        var preferred = candidates.length ? candidates[candidates.length - 1] : host;
        var alternatives = candidates.filter(function (c) {
            return c !== preferred;
        });
        return {preferred: preferred, alternatives: alternatives};
    }

    /* Returns {key, config, inherited} for the page URL, or null. */
    function findSite(settings, url) {
        var host = hostOf(url);
        if (!host) {
            return null;
        }
        var candidates = keyCandidates(host);
        for (var i = 0; i < candidates.length; i++) {
            var stored = settings.sites[candidates[i]];
            if (stored) {
                return {
                    key: candidates[i],
                    config: assign(SITE_DEFAULTS, settings.siteDefaults, stored),
                    inherited: candidates[i] !== host
                };
            }
        }
        return null;
    }

    async function putSite(key, config) {
        var settings = await load();
        var sites = assign(settings.sites);
        sites[key] = assign(SITE_DEFAULTS, config);
        await browser.storage.local.set({sites: sites});
        return sites[key];
    }

    async function deleteSite(key) {
        var settings = await load();
        var sites = assign(settings.sites);
        delete sites[key];
        await browser.storage.local.set({sites: sites});
    }

    return {
        SITE_DEFAULTS: SITE_DEFAULTS,
        SETTINGS_DEFAULTS: SETTINGS_DEFAULTS,
        assign: assign,
        load: load,
        save: save,
        hostOf: hostOf,
        keyCandidates: keyCandidates,
        suggestSiteNames: suggestSiteNames,
        findSite: findSite,
        putSite: putSite,
        deleteSite: deleteSite
    };
})();
