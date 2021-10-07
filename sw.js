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

var CACHE_NAME = 'masterpassword-cache-v3';
var urlsToCache = [
    '/MasterPasswordJS/',
    'index.html',
    'masterpassword.js',
    'css/bootstrap.min.css',
    'css/bootstrap-theme.min.css',
    'bootstrap-touchspin/jquery.bootstrap-touchspin.min.css',
    'https://ajax.googleapis.com/ajax/libs/jquery/1.11.3/jquery.min.js',
    'js/bootstrap.min.js',
    'bootstrap-touchspin/jquery.bootstrap-touchspin.min.js',
    'crunch.js',
    'scrypt.js',
    'sha256.js',
];

// TODO cache font files: https://googlechrome.github.io/samples/service-worker/selective-caching/service-worker.js
// or do it automatically - see below

self.addEventListener('install', function (event) {
    // Perform install steps
    event.waitUntil(
            caches.open(CACHE_NAME)
            .then(function (cache) {
                console.log('Opened cache');
                return cache.addAll(urlsToCache);
            })
            );
});

self.addEventListener('activate', function(event) {
	event.waitUntil(
	caches.keys().then(function(cacheNames) {
			return Promise.all(
				cacheNames.filter(function(cacheName) {
					// remove old caches
					return CACHE_NAME !== cacheName;
				}).map(function(cacheName) {
					return caches.delete(cacheName);
				})
			);
		})
	);
});

self.addEventListener('fetch', function (event) {
    event.respondWith(
            caches.match(event.request)
            .then(function (response) {
                // Cache hit - return response
                if (response) {
                    return response;
                }

                // IMPORTANT: Clone the request. A request is a stream and
                // can only be consumed once. Since we are consuming this
                // once by cache and once by the browser for fetch, we need
                // to clone the response.
                var fetchRequest = event.request.clone();

                return fetch(fetchRequest).then(
                        function (response) {
                            // Check if we received a valid response
                            if (!response || response.status !== 200 || response.type !== 'basic') {
                                return response;
                            }

                            // IMPORTANT: Clone the response. A response is a stream
                            // and because we want the browser to consume the response
                            // as well as the cache consuming the response, we need
                            // to clone it so we have two streams.
                            var responseToCache = response.clone();

                            caches.open(CACHE_NAME)
                                    .then(function (cache) {
                                        cache.put(event.request, responseToCache);
                                    });

                            return response;
                        }
                );
            })
            );
});




