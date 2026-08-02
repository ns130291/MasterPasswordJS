/*
 * Copyright (C) 2014-2026 ns130291
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
 * Site password derivation, shared by the popup, the options page and the
 * background script. This mirrors masterpassword.js of the web app byte for
 * byte so that both produce the same passwords.
 */

"use strict";

var MPW = (function () {
    var SCOPE = "com.lyndir.masterpassword";

    var passChars = {
        n: "0123456789".split(""),
        a: "AEIOUaeiouBCDFGHJKLMNPQRSTVWXYZbcdfghjklmnpqrstvwxyz".split(""),
        V: "AEIOU".split(""),
        C: "BCDFGHJKLMNPQRSTVWXYZ".split(""),
        v: "aeiou".split(""),
        c: "bcdfghjklmnpqrstvwxyz".split(""),
        A: "AEIOUBCDFGHJKLMNPQRSTVWXYZ".split(""),
        o: "@&%?,=[]_:-+*$#!'^~;()/.".split(""),
        x: "AEIOUaeiouBCDFGHJKLMNPQRSTVWXYZbcdfghjklmnpqrstvwxyz0123456789!@#$%^&*()".split("")
    };

    var templates = {
        pin: ["nnnn"],
        pin6: ["nnnnnn"],
        short: ["Cvcn"],
        basic: ["aaanaaan", "aannaaan", "aaannaaa"],
        medium: ["CvcnoCvc", "CvcCvcno"],
        long: ["CvcvnoCvcvCvcv", "CvcvCvcvnoCvcv", "CvcvCvcvCvcvno", "CvccnoCvcvCvcv", "CvccCvcvnoCvcv", "CvccCvcvCvcvno", "CvcvnoCvccCvcv", "CvcvCvccnoCvcv", "CvcvCvccCvcvno", "CvcvnoCvcvCvcc", "CvcvCvcvnoCvcc", "CvcvCvcvCvccno", "CvccnoCvccCvcv", "CvccCvccnoCvcv", "CvccCvccCvcvno", "CvcvnoCvccCvcc", "CvcvCvccnoCvcc", "CvcvCvccCvccno", "CvccnoCvcvCvcc", "CvccCvcvnoCvcc", "CvccCvcvCvccno"],
        maximum: ["anoxxxxxxxxxxxxxxxxx", "axxxxxxxxxxxxxxxxxno"]
    };

    var TYPES = [
        {id: "pin", label: "Pin"},
        {id: "pin6", label: "Pin6"},
        {id: "short", label: "Short"},
        {id: "basic", label: "Basic"},
        {id: "medium", label: "Medium"},
        {id: "long", label: "Long"},
        {id: "maximum", label: "Maximum"}
    ];

    var VERSIONS = [1, 2, 3];

    /* Length of the UTF-8 encoding of str, for characters up to 0xFFFF. */
    function stringLength(str) {
        var length = 0;
        for (var i = 0; i < str.length; i++) {
            length++;
            if (str.charCodeAt(i) > 127) {
                length++;
                if (str.charCodeAt(i) > 2047) {
                    length++;
                }
            }
        }
        return length;
    }

    /*
     * The web app's intToHexString(): an integer as four nibbles, most
     * significant first. Kept exactly as the web app has always done it --
     * changing it would change every password it has ever produced.
     */
    function nibbleBytes(value) {
        var out = [];
        for (var i = 3; i >= 0; i--) {
            out.push(Math.floor(value / Math.pow(16, i)) % 16);
        }
        return out;
    }

    /*
     * What the Master Password specification asks for: a big-endian uint32.
     * Identical to the nibble encoding below 16 and different above it, which
     * is why passwords for names or site names of 16 characters or more differ
     * between this implementation and the official apps.
     */
    function be32Bytes(value) {
        return [(value >>> 24) & 255, (value >>> 16) & 255,
            (value >>> 8) & 255, value & 255];
    }

    /*
     * Replicates the UTF-8 encoder of the bundled jsSHA 1.x exactly, including
     * its two off-by-one boundaries (U+0080 is emitted raw, U+0800 as two
     * bytes) and its per-code-unit handling of surrogate pairs. Every password
     * the web app has ever produced depends on these quirks.
     */
    function legacyBytes(str) {
        var out = [];
        for (var i = 0; i < str.length; i++) {
            var code = str.charCodeAt(i);
            if (code > 2048) {
                out.push(224 | ((code & 61440) >>> 12),
                    128 | ((code & 4032) >>> 6), 128 | (code & 63));
            } else if (code > 128) {
                out.push(192 | ((code & 1984) >>> 6), 128 | (code & 63));
            } else {
                out.push(code);
            }
        }
        return out;
    }

    /* Correct UTF-8, used when spec-compliant encoding is switched on. */
    function specBytes(str) {
        return Array.prototype.slice.call(new TextEncoder().encode(str));
    }

    function toHex(bytes) {
        var hex = "";
        for (var i = 0; i < bytes.length; i++) {
            hex += (bytes[i] < 16 ? "0" : "") + (bytes[i] & 255).toString(16);
        }
        return hex;
    }

    function getI(seed, i) {
        if (i * 2 > seed.length) {
            return -1;
        }
        return parseInt(seed.substr(i * 2, 2), 16);
    }

    /*
     * keys: {legacy: {v12, v3}, spec: {v12, v3}} as produced by crunch.js.
     *
     * The v1 algorithm counts the site name in UTF-16 code units, v2 and v3
     * count it in bytes. v3 additionally uses a master key whose salt counts
     * the user name in bytes.
     *
     * specCompliant switches every length and the counter from the web app's
     * nibble encoding to the big-endian uint32 the official Master Password
     * apps use, and picks the matching master key.
     */
    function sitePassword(keys, site, counter, type, version, specCompliant) {
        version = parseInt(version, 10) || 3;
        counter = parseInt(counter, 10) || 1;
        specCompliant = !!specCompliant;

        var keySet = specCompliant ? keys.spec : keys.legacy;
        var key = keySet && (version >= 3 ? keySet.v3 : keySet.v12);
        if (!key) {
            throw new Error("locked");
        }

        var encodeText = specCompliant ? specBytes : legacyBytes;
        var encodeInt = specCompliant ? be32Bytes : nibbleBytes;
        var siteLength = version === 1
            ? site.length
            : (specCompliant ? specBytes(site).length : stringLength(site));

        /*
         * Fed to jsSHA as HEX rather than TEXT so that the byte layout is
         * explicit: a big-endian length can contain bytes above 0x7F, which
         * jsSHA's TEXT path would re-encode as two bytes. For the legacy
         * encoding this produces exactly the same bytes as before.
         */
        var message = toHex(encodeText(SCOPE)) +
            toHex(encodeInt(siteLength)) +
            toHex(encodeText(site)) +
            toHex(encodeInt(counter));

        var shaObj = new jsSHA(message, "HEX");
        var siteSeed = shaObj.getHMAC(key, "HEX", "SHA-256", "HEX");

        var candidates = templates[type];
        if (!candidates) {
            throw new Error("unknown password type: " + type);
        }
        var template = candidates[parseInt(siteSeed.substr(0, 2), 16) % candidates.length];

        var sitePW = "";
        for (var i = 0; i < template.length; i++) {
            var chars = passChars[template.charAt(i)];
            sitePW += chars[getI(siteSeed, i + 1) % chars.length];
        }
        return sitePW;
    }

    return {
        SCOPE: SCOPE,
        TYPES: TYPES,
        VERSIONS: VERSIONS,
        stringLength: stringLength,
        sitePassword: sitePassword
    };
})();

if (typeof module !== "undefined" && module.exports) {
    module.exports = MPW;
}
