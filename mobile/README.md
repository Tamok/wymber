# Wymber mobile (Capacitor)

The Android and (later) iOS apps. This is a **native shell over the single web core**: Capacitor
loads the existing `frontend/` unchanged, and we add native capability (durable storage, biometric
unlock, share/export) only where it genuinely beats web. The decision and rationale are in
[ADR-0005](../docs/adr/0005-mobile-native-shell-single-web-core.md); the plan is in
[docs/mobile/roadmap.md](../docs/mobile/roadmap.md).

One Capacitor project targets **both** platforms. The web core stays the single source of truth in
`frontend/`; a thin staging step (`npm run prepare:web`, run automatically by the `sync`/`copy`/`add`
scripts) mirrors it into `mobile/www/` (the `webDir`). Staging exists for one reason: the web app
uses absolute `/static/...` asset URLs (the server maps `/static` -> `frontend/`), so `www/` mirrors
`frontend/` at **both** the root and under `static/`, so `/` and `/static/` resolve inside the
WebView. `frontend/` itself is never modified. (See [scripts/prepare-web.mjs](scripts/prepare-web.mjs).)

## Prerequisites

- Node 20+ (repo uses 22).
- **Android:** Android Studio + Android SDK (Platform 34+), a JDK 17.
- **iOS** (later, on macOS only): Xcode + CocoaPods.

## First-time setup

```bash
cd mobile
npm install
npm run add:android        # stages www/, generates mobile/android/ (needs the Android SDK)
npm run sync               # stages www/, copies into the native project + installs plugins
npx cap open android       # opens Android Studio; Run onto a device/emulator
```

`android/`, `ios/`, and the generated `www/` are git-ignored. Once you start customizing the native
projects (signing, splash, permissions, `Info.plist`), un-ignore and commit them, see
[.gitignore](.gitignore).

## Dev loop

After any change to `frontend/`:

```bash
cd mobile
npm run sync      # re-stages www/ from frontend/, then cap sync   (use: npm run copy for web assets only)
```

then re-run from Android Studio / Xcode. (No bundler: the frontend is plain ES modules; `prepare:web`
is just a copy.)

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

> **Service worker:** `/static/js/native-persistence.js` is in the precache list in `frontend/sw.js`,
> and `VERSION` is regenerated automatically by the pre-commit hook (`scripts/sw-version.mjs`), so
> returning PWA users get the new module offline.

## Release signing (upload key)

Release builds are signed with an **upload key** for Play App Signing (Google holds the
distribution key; a lost upload key is resettable via Play Console support, back it up anyway).
The key lives OUTSIDE the repo:

- `.secrets/android/wymber-upload.keystore` (RSA-4096, alias `wymber-upload`)
- `.secrets/android/keystore.properties` (storeFile/storePassword/keyAlias/keyPassword)

`android/app/build.gradle` resolves signing in this order: **CI env vars** (`KEYSTORE_FILE`,
`KEYSTORE_PASSWORD`, `KEY_ALIAS`, `KEY_PASSWORD`, or point `WYMBER_KEYSTORE_PROPERTIES` at a
properties file) → **local `.secrets` file** → **unsigned release** (still buildable, not
installable). Build:

```bash
cd mobile/android
./gradlew :app:bundleRelease     # AAB for Play (app/build/outputs/bundle/release/)
./gradlew :app:assembleRelease   # APK for direct sideload (app/build/outputs/apk/release/)
```

Store readiness / Play Console plan: [docs/mobile/play-store-readiness.md](../docs/mobile/play-store-readiness.md).

## Conventions / decisions to confirm

- **App ID** is `app.wymber` (reverse of the `wymber.app` domain). It becomes the Android
  `applicationId` and the iOS bundle identifier, semi-permanent once a store listing exists, so
  confirm it before the first store submission (tracked under store readiness, **#149**).
- **App name** is `Wymber`.

## Roadmap

See [docs/mobile/roadmap.md](../docs/mobile/roadmap.md) and epic **#56**.
