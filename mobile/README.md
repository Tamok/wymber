# Wymber mobile (Capacitor)

The Android and (later) iOS apps. This is a **native shell over the single web core**: Capacitor
loads the existing `frontend/` unchanged, and we add native capability (durable storage, biometric
unlock, share/export) only where it genuinely beats web. The decision and rationale are in
[ADR-0005](../docs/adr/0005-mobile-native-shell-single-web-core.md); the plan is in
[docs/mobile/roadmap.md](../docs/mobile/roadmap.md).

One Capacitor project targets **both** platforms. `webDir` points at `../frontend`, so the shell
and the web core move together with no copy ritual and no build step.

## Prerequisites

- Node 20+ (repo uses 22).
- **Android:** Android Studio + Android SDK (Platform 34+), a JDK 17.
- **iOS** (later, on macOS only): Xcode + CocoaPods.

## First-time setup

```bash
cd mobile
npm install
npx cap add android        # generates mobile/android/ (needs the Android SDK)
npx cap sync               # copies ../frontend into the native project + installs plugins
npx cap open android       # opens Android Studio; Run onto a device/emulator
```

`android/` and `ios/` are generated and currently git-ignored. Once you start customizing them
(signing, splash, permissions, `Info.plist`), un-ignore and commit them, see [.gitignore](.gitignore).

## Dev loop

After any change to `frontend/`:

```bash
cd mobile
npx cap sync      # or: npx cap copy   (web assets only, faster)
```

then re-run from Android Studio / Xcode. (No build step: the frontend is plain ES modules.)

## The native vault backend

[`frontend/js/native-persistence.js`](../frontend/js/native-persistence.js) is the native storage
backend. It lives under `frontend/` because the WebView only serves `webDir`, but it activates only
on the native shell. It implements the same interface `LocalRepo` injects (`hasVault` / `loadVault`
/ `saveVault` / `clearVault`, see `frontend/js/local-repo.js`) and writes the **sealed** vault blob
to app-private native storage via the Capacitor Filesystem plugin, instead of OPFS/IndexedDB. Why:
ADR-0005 (the WKWebView 10 MB OPFS cap, weak `persist()` on iOS, and WebView storage eviction make
browser storage unsafe as the system of record). Only ciphertext is written; the WebView still does
all the crypto, so zero-knowledge holds. Tracked in **#145**.

It is wired in at the `new LocalRepo()` site in `frontend/js/app.js`, guarded by `isNativeShell()`,
so the web build is unchanged and only the native shell uses it:

```js
const api = isNativeShell()
    ? new LocalRepo({ persistence: new NativePersistence() })
    : new LocalRepo();
```

> **Service-worker follow-up (app owner):** when the web shell is next deployed, add
> `/static/js/native-persistence.js` to the precache list in `frontend/sw.js` and regenerate
> `VERSION` (`scripts/sw-version.mjs`), so returning PWA users get the new module offline. Not done
> here, that is an app-shell change.

## Conventions / decisions to confirm

- **App ID** is `app.wymber` (reverse of the `wymber.app` domain). It becomes the Android
  `applicationId` and the iOS bundle identifier, semi-permanent once a store listing exists, so
  confirm it before the first store submission (tracked under store readiness, **#149**).
- **App name** is `Wymber`.

## Roadmap

See [docs/mobile/roadmap.md](../docs/mobile/roadmap.md) and epic **#56**.
