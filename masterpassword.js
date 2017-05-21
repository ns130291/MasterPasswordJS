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

var cruncher = new Worker("crunch.js");

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
var masterKeyv3 = null;

var passwordGen;
var loginForm;
var generating;

var timeoutTimer;
var loginTimeout = 300000; // ms --> 5 min

if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
        navigator.serviceWorker.register('sw.js').then(function (registration) {
            // Registration was successful
            console.log('ServiceWorker registration successful with scope: ', registration.scope);
        }, function (err) {
            // registration failed :(
            console.log('ServiceWorker registration failed: ', err);
        });
    });
}


window.addEventListener('DOMContentLoaded', function () {
    passwordGen = document.getElementById("password-gen")
    loginForm = document.getElementById("login-form");
    generating = document.getElementById("generating");

    var loginbtn = document.getElementById("login");
    loginbtn.addEventListener('click', login, false);
    var logoutbtn = document.getElementById("logout");
    logoutbtn.addEventListener("click", logout, false);

    var sitename = document.getElementById("sitename");
    sitename.addEventListener('input', getPW, false);
    $("#counter").on("change", getPW);
    var pwtype = document.getElementById("pwtype");
    pwtype.addEventListener('change', getPW, false);

    cruncher.onmessage = function (e) {
        masterKey = e.data.key;
        masterKeyv3 = e.data.key_v3;
        passwordGen.removeAttribute("disabled");
        passwordGen.style.display = "block";
        loginForm.style.display = "none";
        generating.style.display = "none";
        startLogoutTimer();
    };
}, false);

function login() {
    passwordGen.style.display = "none";
    loginForm.style.display = "none";
    generating.style.display = "block";

    passwordGen.setAttribute("disabled", "disabled");
    document.getElementById("sitename").value = "";
    document.getElementById("sitepw").value = "";
    document.getElementById("sitepw2").value = "";
    document.getElementById("sitepw3").value = "";

    let login = {};
    login.name = document.getElementById("name").value;
    login.pw = document.getElementById("pw").value;

    cruncher.postMessage(login);
}

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

function logout() {
    document.getElementById("password-gen").setAttribute("disabled", "disabled");
    document.getElementById("sitepw").value = "";
    document.getElementById("sitepw2").value = "";
    document.getElementById("sitepw3").value = "";
    document.getElementById("sitename").value = "";
    document.getElementById("pw").value = "";
    masterKey = null;
    masterKeyv3 = null;
    passwordGen.style.display = "none";
    loginForm.style.display = "block";
    generating.style.display = "none";
}

function startLogoutTimer() {
    window.clearTimeout(timeoutTimer);
    timeoutTimer = window.setTimeout(logout, loginTimeout);
}

function getPW() {
    if (masterKey === null) {
        return;
    }

    startLogoutTimer();

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
    getPWv2();
}

function getPWv2() {
    if (masterKey === null) {
        return;
    }

    var site = document.getElementById("sitename").value;
    var siteCounter = document.getElementById("counter").value;
    var siteName = "com.lyndir.masterpassword" + intToHexString(stringLength(site)) + site + intToHexString(siteCounter);

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
    document.getElementById("sitepw2").value = sitePW;
    getPWv3();
}

function getPWv3() {
    if (masterKeyv3 === null) {
        return;
    }

    var site = document.getElementById("sitename").value;
    var siteCounter = document.getElementById("counter").value;
    var siteName = "com.lyndir.masterpassword" + intToHexString(stringLength(site)) + site + intToHexString(siteCounter);

    var shaObj = new jsSHA(siteName, "TEXT");
    var siteSeed = shaObj.getHMAC(masterKeyv3, "HEX", "SHA-256", "HEX");

    var typepw = document.getElementById("pwtype");
    var type = typepw.options[typepw.selectedIndex].value;
    var templates = getTemplate(type);
    var template = templates[parseInt(siteSeed.substr(0, 2), 16) % templates.length];
    var sitePW = "";
    for (var i = 0; i < template.length; i++) {
        var passChars = getPassChars(template.charAt(i));
        sitePW += passChars[getI(siteSeed, i + 1) % passChars.length];
    }
    document.getElementById("sitepw3").value = sitePW;
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
