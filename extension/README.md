# MasterPasswordJS — Firefox extension

Logs you in with passwords derived from your master password, and remembers the
settings (password type, counter, algorithm version, user name) for each site.

It uses exactly the same algorithm and the same character sets and templates as
the web app in the repository root, so a site that gives you `Zuku1'MabiQack` on
<https://ns130291.github.io/MasterPasswordJS/> gives you the same password here.

## Installing

Temporarily, for testing:

1. Open `about:debugging#/runtime/this-firefox`
2. *Load Temporary Add-on…* and pick `extension/manifest.json`
3. Grant access to websites when Firefox asks

Permanently you need a signed build: zip the contents of `extension/` (the
`manifest.json` must sit at the top level of the zip) and submit it to
<https://addons.mozilla.org/developers/> as an unlisted add-on, or run Firefox
Developer Edition / Nightly with `xpinstall.signatures.required` set to `false`.

Content scripts are only injected into pages loaded *after* installation, so
reload any tab you already had open.

## Using it

1. Click the toolbar icon and unlock with your name and master password.
   Deriving the two master keys with scrypt takes a few seconds.
2. Open a login page. The popup proposes a domain derived from the address (the
   last two labels of the host, the same as the web app does) and offers the
   more specific alternatives as chips.
3. Adjust password type, counter and algorithm version until the password
   matches the one the site expects, optionally fill in the user name to enter,
   and press **Save site**.
4. From then on the site is recognised. Depending on the site's settings the
   login is filled automatically on page load, or you press <kbd>Ctrl</kbd> +
   <kbd>Shift</kbd> + <kbd>L</kbd>, or you click the small key button that
   appears inside the password field.

The keys are kept in `storage.session`: memory only, never written to disk, and
discarded when Firefox closes or after the auto-lock timeout (15 minutes by
default, configurable including "never").

## Sites that changed their address

An entry is *stored* under the domain of the page it applies to, but the
password is *derived* from the domain in the **Domain used for the password**
field, and the two do not have to be the same. So for a site that moved from
`old-name.com` to `new-name.com`, save the entry while you are on
`new-name.com` and set that field to `old-name.com`: the entry is found by the
address you actually visit, while the password stays the one you have always
used. Whenever the two differ, the popup and the settings page say so
explicitly, and the chips next to the field offer the current domain back.

Because the lookup walks up the domain, an entry saved for `new-name.com` also
covers `www.new-name.com`, `accounts.new-name.com` and so on.

## Encoding: this add-on's passwords vs. the official apps

Where the Master Password specification encodes a length or a counter as a
big-endian `uint32`, this implementation has always written four nibbles
instead. Below 16 the two are the same, from 16 upwards they are not — so for
any user name or domain of 16 characters or more, the web app and the official
Master Password apps produce *different* passwords.

The per-site option **Official Master Password encoding** (off by default,
`specCompliant` in the settings file) switches an entry over to the
specification's encoding, for both the master key salt and the site seed. Turn
it on for accounts whose password you created with an official app, leave it
off for everything you created here. The default for new sites is configurable
on the settings page.

Both behaviours are covered by test vectors: with the option on, name
`Robert Lee Mitchell`, master password `banana colored duckling`, site
`masterpasswordapp.com`, long, counter 1, v3 gives `Jejr5[RepuSosp` — the
official test vector. With it off the same input gives `Gule3@WutmYice`, which
is what the web app produces.

Switching the option on does not slow unlocking down noticeably: the four
possible master keys are deduplicated before hashing, so a user name shorter
than 16 characters needs a single scrypt run for all of them.

## How this behaves towards Firefox's own password manager

On any site you have *not* configured, the extension does nothing at all — it
adds no elements, registers no handlers on the page and changes no attributes.
Firefox's saved logins keep working exactly as before.

On a site you *have* configured, the per-site option **Hide Firefox's own
password dropdown here** (on by default) suppresses the built-in autocomplete
panel so it does not overlap the extension's own offer. Firefox only offers
saved logins on a real `input[type=password]`, so while such a field is focused
the extension presents it as a text field masked with `-webkit-text-security`.
It looks and behaves the same, and the real `type=password` is restored on blur
and before the form is submitted. If a site misbehaves because of it, turn the
option off for that site — everything else keeps working. On Firefox versions
without `-webkit-text-security` (before 118) the swap is skipped, because the
password must never become visible.

## Security notes

* The master password is only ever typed into the toolbar popup. The in-page
  panel deliberately has no password field: a web page can observe keystrokes
  even inside a closed shadow root.
* Site settings contain no secrets, so *Export settings…* produces a file that
  is safe to keep as a backup.
* The background script derives the site password; content scripts only ever
  receive the one password for the origin they are running in, and the
  background script takes that origin from the sender rather than from the
  message.

## Layout

| Path | Purpose |
| --- | --- |
| `src/mpw.js` | site password derivation, mirrors `masterpassword.js` |
| `src/crunch.js` | worker deriving the two master keys with scrypt |
| `src/background.js` | key storage, auto-lock, messaging, filling |
| `src/content.js` | login form detection, in-page offer, filling |
| `src/popup.*` | unlock, per-site settings, generated password |
| `src/options.*` | defaults, all saved sites, backup |
| `vendor/` | copies of `sha256.js` and `scrypt.js` from the repository root |

`vendor/scrypt.js` differs from the copy in the repository root in exactly two
places, both marked with a `MPWJS-EXT` comment: the two `eval()` calls of the
Emscripten runtime are gone, because the Manifest V3 content security policy
forbids them. Neither is reachable in normal operation.
