/*
 * Copyright (C) 2014,2016 ns130291
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
 
 * You should have received a copy of the GNU General Public License
 * along with MasterPasswordJS.  If not, see <http://www.gnu.org/licenses/>.
 * 
 */

"use strict";

var passChars_n = "0123456789".split("");
var passChars_a = "AEIOUaeiouBCDFGHJKLMNPQRSTVWXYZbcdfghjklmnpqrstvwxyz".split("");
var passChars_V = "AEIOU".split("");
var passChars_C = "BCDFGHJKLMNPQRSTVWXYZ".split("");
var passChars_v = "aeiou".split("");
var passChars_c = "bcdfghjklmnpqrstvwxyz".split("");
var passChars_A = "AEIOUBCDFGHJKLMNPQRSTVWXYZ".split("");
var passChars_o = "@&%?,=[]_:-+*$#!'^~;()/.".split("");
var passChars_x = "AEIOUaeiouBCDFGHJKLMNPQRSTVWXYZbcdfghjklmnpqrstvwxyz0123456789!@#$%^&*()".split("");

var templates_pin = ["nnnn"];
var templates_short = ["Cvcn"];
var templates_basic = ["aaanaaan", "aannaaan", "aaannaaa"];
var templates_medium = ["CvcnoCvc", "CvcCvcno"];
var templates_long = ["CvcvnoCvcvCvcv", "CvcvCvcvnoCvcv", "CvcvCvcvCvcvno", "CvccnoCvcvCvcv", "CvccCvcvnoCvcv", "CvccCvcvCvcvno", "CvcvnoCvccCvcv", "CvcvCvccnoCvcv", "CvcvCvccCvcvno", "CvcvnoCvcvCvcc", "CvcvCvcvnoCvcc", "CvcvCvcvCvccno", "CvccnoCvccCvcv", "CvccCvccnoCvcv", "CvccCvccCvcvno", "CvcvnoCvccCvcc", "CvcvCvccnoCvcc", "CvcvCvccCvccno", "CvccnoCvcvCvcc", "CvccCvcvnoCvcc", "CvccCvcvCvccno"];
var templates_maximum = ["anoxxxxxxxxxxxxxxxxx", "axxxxxxxxxxxxxxxxxno"];

var masterKey = null;

window.addEventListener('DOMContentLoaded', function () {
    var loginbtn = document.getElementById("login");
    loginbtn.addEventListener('click', login, false);
    var logoutbtn = document.getElementById("logout");
    logoutbtn.addEventListener("click", logout, false);

    var sitename = document.getElementById("sitename");
    sitename.addEventListener('input', getPW, false);
    var counter = document.getElementById("counter");
    counter.addEventListener('change', getPW, false);
    var pwtype = document.getElementById("pwtype");
    pwtype.addEventListener('change', getPW, false);
}, false);

function login() {
    var passwordGen = document.getElementById("password-gen");
    passwordGen.setAttribute("disabled", "disabled");
    var scrypt = scrypt_module_factory(Math.pow(2, 26));

    var masterName = document.getElementById("name").value;
    var masterPW = scrypt.encode_utf8(document.getElementById("pw").value);

    var masterSalt1 = scrypt.encode_utf8("com.lyndir.masterpassword");
    var masterSalt2 = intToByteArray(masterName.length);
    var masterSalt3 = scrypt.encode_utf8(masterName);
    var masterSalt = Uint8ArrayConcat(Uint8ArrayConcat(masterSalt1, masterSalt2), masterSalt3);

    var N = 32768;
    var r = 8;
    var p = 2;
    var l = 64;

    masterKey = scrypt.crypto_scrypt(masterPW, masterSalt, N, r, p, l);

    masterKey = scrypt.to_hex(masterKey);
    passwordGen.removeAttribute("disabled");
}

function logout() {
    document.getElementById("password-gen").setAttribute("disabled", "disabled");
    document.getElementById("sitepw").value = "";
    document.getElementById("sitename").value = "";
    masterKey = null;
}

function getPW() {
    if (masterKey === null) {
        return;
    }

    var site = document.getElementById("sitename").value;
    var siteCounter = document.getElementById("counter").value;
    var siteName = "com.lyndir.masterpassword" + intToHexString(site.length) + site + intToHexString(siteCounter);

    var shaObj = new jsSHA(siteName, "TEXT");
    var siteSeed = shaObj.getHMAC(masterKey, "HEX", "SHA-256", "HEX");

    var typepw = document.getElementById("pwtype");
    var type = typepw.options[typepw.selectedIndex].value;

    var templates = getTemplate(type);
    var template = templates[parseInt(siteSeed.substr(0, 2), 16) % templates.length];

    var sitePW = "";
    for (var i = 0; i < template.length; i++) {
        var passChars = getPassChars(template.charAt(i));
        sitePW += passChars[getI(siteSeed, i + 1) % passChars.length];
    }
    document.getElementById("sitepw").value = sitePW;
}

function getTemplate(type) {
    switch (type) {
        case "pin":
            return templates_pin;
        case "short":
            return templates_short;
        case "basic":
            return templates_basic;
        case "medium":
            return templates_medium;
        case "long":
            return templates_long;
        case "maximum":
            return templates_maximum;
    }
}

function getPassChars(char) {
    switch (char) {
        case "n":
            return passChars_n;
        case "a":
            return passChars_a;
        case "A":
            return passChars_A;
        case "c":
            return passChars_c;
        case "C":
            return passChars_C;
        case "v":
            return passChars_v;
        case "V":
            return passChars_V;
        case "x":
            return passChars_x;
        case "o":
            return passChars_o;
    }
}

function getI(seed, i) {
    if (i * 2 > seed.length) {
        return -1;
    }
    return parseInt(seed.substr(i * 2, 2), 16);
}

function intToByteArray(intA) {
    var arr = new Uint8Array(4);
    for (var i = 3; i >= 0; i--) {
        arr[i] = intA % 16;
        intA = intA / 16;
    }
    return arr;
}

function intToHexString(intA) {
    var arr = "";
    for (var i = 0; i < 4; i++) {
        var s = intA % 16;
        arr = String.fromCharCode(s) + arr;
        intA = parseInt(intA / 16);
    }
    return arr;
}

function Uint8arrayToString(array) {
    var s = "";
    for (var i = 0; i < array.length; i++) {
        s += String.fromCharCode(array[i]);
    }
    return s;
}

function Uint8ArrayConcat(array1, array2) {
    var array = new Uint8Array(array1.byteLength + array2.byteLength);
    array.set(new Uint8Array(array1), 0);
    array.set(new Uint8Array(array2), array1.byteLength);
    return array;
}