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
 * Derives the master keys with scrypt.
 *
 * Four keys exist, one per combination of
 *   - algorithm version: v1/v2 count the user name in UTF-16 code units,
 *     v3 counts it in UTF-8 bytes, and
 *   - length encoding: "legacy" is what the web app has always done, "spec"
 *     is the big-endian uint32 the official Master Password apps use.
 *
 * The two encodings only differ for lengths of 16 and above, so for a short
 * ASCII user name all four salts are equal and a single scrypt run covers
 * them all. Salts are therefore deduplicated before hashing.
 */

"use strict";

importScripts("../vendor/scrypt.js");

/*
 * The web app's intToByteArray(): four nibbles, most significant first. The
 * original relied on Uint8Array truncating the float division, this spells the
 * same result out.
 */
function nibbleBytes(value) {
    let arr = new Uint8Array(4);
    for (let i = 3; i >= 0; i--) {
        arr[i] = Math.floor(value / Math.pow(16, 3 - i)) % 16;
    }
    return arr;
}

/* What the Master Password specification actually asks for. */
function be32Bytes(value) {
    let arr = new Uint8Array(4);
    arr[0] = (value >>> 24) & 255;
    arr[1] = (value >>> 16) & 255;
    arr[2] = (value >>> 8) & 255;
    arr[3] = value & 255;
    return arr;
}

function Uint8ArrayConcat(array1, array2) {
    let array = new Uint8Array(array1.byteLength + array2.byteLength);
    array.set(new Uint8Array(array1), 0);
    array.set(new Uint8Array(array2), array1.byteLength);
    return array;
}

function stringLength(str) {
    let length = 0;
    for (let i = 0; i < str.length; i++) {
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

self.onmessage = function (e) {
    let requestId = e.data.requestId;
    try {
        let scrypt = scrypt_module_factory(Math.pow(2, 26));

        let masterName = e.data.name;
        let masterPW = scrypt.encode_utf8(e.data.pw);

        let N = 32768;
        let r = 8;
        let p = 2;
        let l = 64;

        let scopeBytes = scrypt.encode_utf8("com.lyndir.masterpassword");
        let nameBytes = scrypt.encode_utf8(masterName);

        let nameLengths = {
            v12: masterName.length,
            v3: stringLength(masterName)
        };
        let encodings = {
            legacy: nibbleBytes,
            spec: be32Bytes
        };

        let bySalt = {};
        let keys = {legacy: {}, spec: {}};

        Object.keys(encodings).forEach(function (encoding) {
            Object.keys(nameLengths).forEach(function (variant) {
                let lengthBytes = encodings[encoding](nameLengths[variant]);
                let signature = Array.prototype.join.call(lengthBytes, ",");
                if (!bySalt[signature]) {
                    let salt = Uint8ArrayConcat(
                        Uint8ArrayConcat(scopeBytes, lengthBytes), nameBytes);
                    bySalt[signature] = scrypt.to_hex(
                        scrypt.crypto_scrypt(masterPW, salt, N, r, p, l));
                }
                keys[encoding][variant] = bySalt[signature];
            });
        });

        self.postMessage({
            requestId: requestId,
            legacy: keys.legacy,
            spec: keys.spec
        });
    } catch (err) {
        self.postMessage({requestId: requestId, error: String(err && err.message || err)});
    }
};
