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
 * Runs on every page but stays completely passive unless a site
 * configuration exists for the current origin. On unconfigured sites nothing
 * is touched, so Firefox's own password manager keeps working as usual.
 *
 * The master password is never entered here: the page could observe keystrokes
 * even through a closed shadow root, so unlocking only happens in the toolbar
 * popup.
 */

(function () {
    "use strict";

    if (window.__masterPasswordJsContent) {
        return;
    }
    window.__masterPasswordJsContent = true;

    var CAN_MASK = typeof CSS !== "undefined" && CSS.supports &&
        CSS.supports("-webkit-text-security", "disc");

    var state = null;
    var passwordField = null;
    var usernameField = null;
    var ui = null;
    var lastFilledField = null;
    var autofillInFlight = false;
    var maskedFields = new WeakSet();
    var suppressedFields = new WeakSet();
    var rescanTimer = null;

    function send(msg) {
        return browser.runtime.sendMessage(msg).catch(function () {
            return null;
        });
    }

    /* ------------------------------------------------------ field finding */

    function isVisible(el) {
        if (!el || !el.isConnected || el.disabled || el.readOnly) {
            return false;
        }
        var rect = el.getBoundingClientRect();
        if (rect.width < 12 || rect.height < 8) {
            return false;
        }
        var style = window.getComputedStyle(el);
        return style.visibility !== "hidden" && style.display !== "none" &&
            style.opacity !== "0";
    }

    function isPasswordField(el) {
        return el.tagName === "INPUT" &&
            (el.type === "password" || maskedFields.has(el));
    }

    function findPasswordField() {
        var inputs = document.querySelectorAll("input");
        var visibleFields = [];
        for (var i = 0; i < inputs.length; i++) {
            if (isPasswordField(inputs[i]) && isVisible(inputs[i])) {
                visibleFields.push(inputs[i]);
            }
        }
        if (!visibleFields.length) {
            return null;
        }
        /*
         * Two or more password fields usually means a registration or
         * change-password form. Filling the first one is still the useful
         * default, and autofill is skipped in that case.
         */
        return visibleFields[0];
    }

    var USERNAME_HINT = /user|login|email|e-mail|mail|account|kennung|benutzer|ident/i;

    function findUsernameField(pwField) {
        var scope = pwField.form || document;
        var inputs = Array.prototype.slice.call(scope.querySelectorAll("input"));
        var index = inputs.indexOf(pwField);
        var before = index === -1 ? inputs : inputs.slice(0, index);

        var usable = before.filter(function (el) {
            var type = (el.type || "text").toLowerCase();
            return ["text", "email", "tel", "url", ""].indexOf(type) !== -1 &&
                isVisible(el);
        });
        if (!usable.length) {
            return null;
        }

        for (var i = 0; i < usable.length; i++) {
            var ac = (usable[i].getAttribute("autocomplete") || "").toLowerCase();
            if (ac === "username" || ac === "email") {
                return usable[i];
            }
        }
        for (var j = 0; j < usable.length; j++) {
            var haystack = [usable[j].name, usable[j].id, usable[j].placeholder,
                usable[j].getAttribute("aria-label")].join(" ");
            if (USERNAME_HINT.test(haystack)) {
                return usable[j];
            }
        }
        return usable[usable.length - 1];
    }

    function countVisiblePasswordFields() {
        var inputs = document.querySelectorAll("input");
        var n = 0;
        for (var i = 0; i < inputs.length; i++) {
            if (isPasswordField(inputs[i]) && isVisible(inputs[i])) {
                n++;
            }
        }
        return n;
    }

    /* ------------------------------------------------------------ filling */

    function setFieldValue(el, value) {
        if (!el) {
            return;
        }
        try {
            el.focus({preventScroll: true});
        } catch (e) {
            /* ignore */
        }
        el.value = value;
        el.dispatchEvent(new Event("input", {bubbles: true}));
        el.dispatchEvent(new Event("change", {bubbles: true}));
    }

    function submitLogin(field) {
        var form = field.form;
        if (form) {
            var button = form.querySelector(
                "button[type=submit], input[type=submit], input[type=image], button:not([type])");
            if (button && isVisible(button)) {
                button.click();
                return true;
            }
            if (typeof form.requestSubmit === "function") {
                form.requestSubmit();
                return true;
            }
            form.submit();
            return true;
        }
        field.dispatchEvent(new KeyboardEvent("keydown", {
            key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true
        }));
        return true;
    }

    function doFill(username, password, submit) {
        /*
         * Re-find the fields directly instead of going through attach(), which
         * would be able to start another autofill from in here.
         */
        if (!passwordField || !passwordField.isConnected) {
            passwordField = findPasswordField();
            usernameField = passwordField ? findUsernameField(passwordField) : null;
        }
        if (!passwordField) {
            return {ok: false, reason: "no-form"};
        }
        unmask(passwordField);
        if (username && usernameField) {
            setFieldValue(usernameField, username);
        }
        setFieldValue(passwordField, password);
        lastFilledField = passwordField;
        hidePanel();

        if (submit) {
            var field = passwordField;
            window.setTimeout(function () {
                submitLogin(field);
            }, 60);
        }
        return {ok: true};
    }

    async function fillFromBackground(submit) {
        var result = await send({cmd: "fillMe", submit: submit});
        if (!result || result.error) {
            return {ok: false, reason: "error"};
        }
        if (!result.ok) {
            return result;
        }
        return doFill(result.username, result.password, result.submit);
    }

    /* ------------------------------ hiding the built-in Firefox dropdown */

    /*
     * Firefox only offers its saved logins on real input[type=password]
     * elements. While such a field is focused we present it as a text field
     * that is masked with -webkit-text-security, which keeps it looking and
     * behaving like a password field but takes it out of the password
     * manager's view. The real type is restored on blur and before submit,
     * so the page sees a normal password field the rest of the time.
     */
    function mask(el) {
        if (!CAN_MASK || maskedFields.has(el) || el.type !== "password") {
            return;
        }
        el.__mpInlineSecurity = el.style.getPropertyValue("-webkit-text-security");
        el.__mpInlinePriority = el.style.getPropertyPriority("-webkit-text-security");
        el.style.setProperty("-webkit-text-security", "disc", "important");
        el.type = "text";
        maskedFields.add(el);
    }

    function unmask(el) {
        if (!el || !maskedFields.has(el)) {
            return;
        }
        maskedFields.delete(el);
        el.type = "password";
        if (el.__mpInlineSecurity) {
            el.style.setProperty("-webkit-text-security", el.__mpInlineSecurity,
                el.__mpInlinePriority);
        } else {
            el.style.removeProperty("-webkit-text-security");
        }
    }

    function onSuppressPointerDown(ev) {
        mask(ev.currentTarget);
    }

    function onSuppressFocus(ev) {
        mask(ev.currentTarget);
    }

    function onSuppressBlur(ev) {
        unmask(ev.currentTarget);
    }

    function onSuppressKeyDown(ev) {
        if (ev.key === "Enter") {
            unmask(ev.currentTarget);
        }
    }

    function onSuppressSubmit(ev) {
        var inputs = ev.target.querySelectorAll("input");
        for (var i = 0; i < inputs.length; i++) {
            unmask(inputs[i]);
        }
    }

    function installSuppression(el) {
        if (!CAN_MASK || suppressedFields.has(el)) {
            return;
        }
        suppressedFields.add(el);
        el.setAttribute("autocomplete", "off");
        el.addEventListener("pointerdown", onSuppressPointerDown, true);
        el.addEventListener("focusin", onSuppressFocus, true);
        el.addEventListener("blur", onSuppressBlur, true);
        el.addEventListener("keydown", onSuppressKeyDown, true);
        if (el.form) {
            el.form.addEventListener("submit", onSuppressSubmit, true);
        }
        if (document.activeElement === el) {
            mask(el);
        }
    }

    function removeSuppression(el) {
        if (!el || !suppressedFields.has(el)) {
            return;
        }
        suppressedFields.delete(el);
        unmask(el);
        el.removeEventListener("pointerdown", onSuppressPointerDown, true);
        el.removeEventListener("focusin", onSuppressFocus, true);
        el.removeEventListener("blur", onSuppressBlur, true);
        el.removeEventListener("keydown", onSuppressKeyDown, true);
        if (el.form) {
            el.form.removeEventListener("submit", onSuppressSubmit, true);
        }
    }

    /* ----------------------------------------------------------- in-page UI */

    var SVG_NS = "http://www.w3.org/2000/svg";
    var KEY_PATH = "M12.65 10A6 6 0 0 0 7 6a6 6 0 0 0 0 12 6 6 0 0 0 5.65-4H17v4h4v-4h2" +
        "v-4H12.65zM7 14a2 2 0 1 1 0-4 2 2 0 0 1 0 4z";

    function keyIcon() {
        var svg = document.createElementNS(SVG_NS, "svg");
        svg.setAttribute("viewBox", "0 0 24 24");
        svg.setAttribute("aria-hidden", "true");
        var path = document.createElementNS(SVG_NS, "path");
        path.setAttribute("d", KEY_PATH);
        svg.appendChild(path);
        return svg;
    }

    var UI_CSS = [
        ":host{all:initial}",
        ".btn{position:fixed;z-index:2147483646;display:flex;align-items:center;",
        "justify-content:center;width:22px;height:22px;padding:0;border:0;border-radius:5px;",
        "background:#7e7e7e;color:#fff;cursor:pointer;box-shadow:0 1px 3px rgba(0,0,0,.35)}",
        ".btn:hover{background:#5f5f5f}",
        ".btn svg{width:15px;height:15px;fill:currentColor}",
        ".btn.locked{background:#b26500}",
        ".panel{position:fixed;z-index:2147483647;min-width:236px;max-width:300px;",
        "padding:10px;border-radius:8px;border:1px solid rgba(0,0,0,.18);background:#fff;",
        "color:#222;font:13px/1.4 system-ui,sans-serif;box-shadow:0 6px 22px rgba(0,0,0,.25)}",
        ".panel h1{margin:0 0 6px;font-size:12px;font-weight:600;color:#666;",
        "text-transform:uppercase;letter-spacing:.04em}",
        ".panel .site{font-weight:600;word-break:break-all}",
        ".panel .meta{margin:2px 0 9px;color:#666;font-size:12px}",
        ".panel button{display:block;width:100%;margin-top:6px;padding:6px 9px;",
        "border:1px solid #c8c8c8;border-radius:6px;background:#f6f6f6;color:#222;",
        "font:inherit;cursor:pointer;text-align:left}",
        ".panel button:hover{background:#ececec}",
        ".panel button.primary{border-color:#3a6ea5;background:#3a6ea5;color:#fff}",
        ".panel button.primary:hover{background:#315c8a}",
        ".panel .hint{margin:8px 0 0;color:#777;font-size:12px}",
        "@media (prefers-color-scheme:dark){",
        ".panel{background:#25262a;color:#eee;border-color:rgba(255,255,255,.16)}",
        ".panel h1,.panel .meta,.panel .hint{color:#a4a4a4}",
        ".panel button{background:#33353b;border-color:#4a4c53;color:#eee}",
        ".panel button:hover{background:#3d4046}}"
    ].join("");

    function buildUi() {
        var host = document.createElement("div");
        host.style.setProperty("all", "initial", "important");
        var root = host.attachShadow({mode: "closed"});

        var style = document.createElement("style");
        style.textContent = UI_CSS;

        var button = document.createElement("button");
        button.type = "button";
        button.className = "btn";
        button.appendChild(keyIcon());
        button.addEventListener("click", function (ev) {
            ev.preventDefault();
            ev.stopPropagation();
            togglePanel();
        });

        var panel = document.createElement("div");
        panel.className = "panel";
        panel.style.display = "none";

        root.appendChild(style);
        root.appendChild(button);
        root.appendChild(panel);
        (document.body || document.documentElement).appendChild(host);

        return {host: host, root: root, button: button, panel: panel, open: false};
    }

    function ensureUi() {
        if (!ui || !ui.host.isConnected) {
            ui = buildUi();
        }
        return ui;
    }

    function positionUi() {
        if (!ui || !passwordField || !passwordField.isConnected) {
            return;
        }
        var rect = passwordField.getBoundingClientRect();
        if (rect.width < 12 || rect.bottom < 0 || rect.top > window.innerHeight) {
            ui.button.style.display = "none";
            hidePanel();
            return;
        }
        ui.button.style.display = "flex";
        var top = rect.top + (rect.height - 22) / 2;
        var left = rect.right - 26;
        ui.button.style.top = Math.round(top) + "px";
        ui.button.style.left = Math.round(left) + "px";

        if (ui.open) {
            ui.panel.style.top = Math.round(rect.bottom + 6) + "px";
            ui.panel.style.left = Math.round(Math.min(rect.left,
                window.innerWidth - 312)) + "px";
        }
    }

    function renderPanel() {
        var panel = ui.panel;
        panel.textContent = "";

        var title = document.createElement("h1");
        title.textContent = "MasterPasswordJS";
        panel.appendChild(title);

        var site = document.createElement("div");
        site.className = "site";
        site.textContent = state.config.site;
        panel.appendChild(site);

        var meta = document.createElement("div");
        meta.className = "meta";
        meta.textContent = state.config.type + " · counter " + state.config.counter +
            " · v" + state.config.version +
            (state.config.specCompliant ? " · official encoding" : "");
        panel.appendChild(meta);

        if (state.unlocked) {
            addButton(panel, "Fill login", "primary", function () {
                fillFromBackground(false);
            });
            addButton(panel, "Fill and log in", "", function () {
                fillFromBackground(true);
            });
        } else {
            var hint = document.createElement("p");
            hint.className = "hint";
            hint.textContent = "Locked. Unlock in the toolbar popup — the master " +
                "password is never typed into a web page.";
            panel.appendChild(hint);
            addButton(panel, "Open MasterPasswordJS", "primary", async function () {
                var res = await send({cmd: "openPopup"});
                if (!res || !res.ok) {
                    hint.textContent = "Click the MasterPasswordJS icon in the " +
                        "toolbar to unlock.";
                }
            });
        }

        addButton(panel, "Site settings…", "", function () {
            send({cmd: "openOptions"});
            hidePanel();
        });
    }

    function addButton(parent, label, className, onClick) {
        var button = document.createElement("button");
        button.type = "button";
        if (className) {
            button.className = className;
        }
        button.textContent = label;
        button.addEventListener("click", onClick);
        parent.appendChild(button);
        return button;
    }

    function togglePanel() {
        if (ui.open) {
            hidePanel();
        } else {
            ui.open = true;
            renderPanel();
            ui.panel.style.display = "block";
            positionUi();
        }
    }

    function hidePanel() {
        if (ui && ui.open) {
            ui.open = false;
            ui.panel.style.display = "none";
        }
    }

    function updateButtonState() {
        if (!ui) {
            return;
        }
        if (state.unlocked) {
            ui.button.classList.remove("locked");
            ui.button.title = "Fill login for " + state.config.site;
        } else {
            ui.button.classList.add("locked");
            ui.button.title = "MasterPasswordJS is locked";
        }
    }

    function teardownUi() {
        if (ui) {
            ui.host.remove();
            ui = null;
        }
    }

    /* ------------------------------------------------------------ lifecycle */

    var frameTicking = false;

    function onViewportChange() {
        if (frameTicking) {
            return;
        }
        frameTicking = true;
        window.requestAnimationFrame(function () {
            frameTicking = false;
            positionUi();
        });
    }

    function attach() {
        var field = findPasswordField();
        if (!field) {
            teardownUi();
            passwordField = null;
            usernameField = null;
            return;
        }

        var changed = field !== passwordField;
        passwordField = field;
        usernameField = findUsernameField(field);

        if (state.config.hideBuiltinDropdown) {
            installSuppression(field);
        } else {
            removeSuppression(field);
        }

        if (state.showInPageButton) {
            ensureUi();
            updateButtonState();
            positionUi();
        } else {
            teardownUi();
        }

        if (changed) {
            send({cmd: "formPresent"});
        }

        /*
         * Only a form with exactly one password field is a login form; two or
         * more mean registration or a password change, which must not be
         * filled behind the user's back.
         */
        var singlePasswordForm = countVisiblePasswordFields() === 1;
        if (state.unlocked && state.config.autofill && singlePasswordForm &&
                !autofillInFlight && lastFilledField !== field && !field.value) {
            autofillInFlight = true;
            /* undefined: let the site's "log in automatically" setting decide */
            fillFromBackground(undefined).then(function () {
                autofillInFlight = false;
            }, function () {
                autofillInFlight = false;
            });
        }
    }

    function teardown() {
        teardownUi();
        if (passwordField) {
            removeSuppression(passwordField);
        }
        passwordField = null;
        usernameField = null;
    }

    async function refresh() {
        var next = await send({cmd: "pageState"});
        if (!next || next.error || !next.supported || !next.configured) {
            state = next;
            teardown();
            return;
        }
        state = next;
        attach();
    }

    function rescan() {
        if (!state || !state.configured) {
            return;
        }
        attach();
    }

    function scheduleRescan() {
        window.clearTimeout(rescanTimer);
        rescanTimer = window.setTimeout(rescan, 250);
    }

    browser.runtime.onMessage.addListener(function (msg) {
        if (msg.cmd === "fill") {
            /*
             * Never type a password into a frame that resolves to a different
             * site than the one it was derived for. A page with a cross-origin
             * iframe must not be able to collect the other site's password.
             */
            if (!state || !state.configured || msg.siteKey !== state.siteKey) {
                return Promise.resolve({ok: false, reason: "no-config"});
            }
            return Promise.resolve(doFill(msg.username, msg.password, msg.submit));
        }
        if (msg.cmd === "stateChanged") {
            refresh();
            return Promise.resolve({ok: true});
        }
        return false;
    });

    window.addEventListener("scroll", onViewportChange, true);
    window.addEventListener("resize", onViewportChange, true);
    document.addEventListener("click", function (ev) {
        if (ui && ui.open && ev.target !== ui.host) {
            hidePanel();
        }
    }, true);

    new MutationObserver(scheduleRescan).observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["type", "hidden"]
    });

    refresh();
})();
