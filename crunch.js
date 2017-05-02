/*
 * Copyright (C) 2014,2016,2017 ns130291
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

importScripts("scrypt.js");

function intToByteArray(intA) {
    let arr = new Uint8Array(4);
    for (let i = 3; i >= 0; i--) {
        arr[i] = intA % 16;
        intA = intA / 16;
    }
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

self.onmessage = function(e) {      
    let scrypt = scrypt_module_factory(Math.pow(2, 26));
    
    let masterName = e.data.name;
    let masterPW = scrypt.encode_utf8(e.data.pw);

    let N = 32768;
    let r = 8;
    let p = 2;
    let l = 64;

    let masterSalt1 = scrypt.encode_utf8("com.lyndir.masterpassword");
    let masterSalt2 = intToByteArray(masterName.length);
    let masterSalt3 = scrypt.encode_utf8(masterName);
    let masterSalt = Uint8ArrayConcat(Uint8ArrayConcat(masterSalt1, masterSalt2), masterSalt3);

    let masterKey = scrypt.crypto_scrypt(masterPW, masterSalt, N, r, p, l);
    masterKey = scrypt.to_hex(masterKey);

    let masterSalt2v3 = intToByteArray(stringLength(masterName));
    let masterSaltv3 = Uint8ArrayConcat(Uint8ArrayConcat(masterSalt1, masterSalt2v3), masterSalt3);

    let masterKeyv3 = scrypt.crypto_scrypt(masterPW, masterSaltv3, N, r, p, l);
    masterKeyv3 = scrypt.to_hex(masterKeyv3);
    
    let keys = {};
    keys.key = masterKey;
    keys.key_v3 = masterKeyv3;
    
    self.postMessage(keys);
};


