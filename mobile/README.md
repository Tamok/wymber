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

[src/native-persistence.js](src/native-persistence.js) is the mobile storage backend. It implements
the same interface `LocalRepo` already injects (`hasVault` / `loadVault` / `saveVault` /
`clearVault`, see `frontend/js/local-repo.js`) and writes the **sealed** vault blob to app-private
native storage via the Capacitor Filesystem plugin, instead of OPFS/IndexedDB. Why: ADR-0005 (the
WKWebView 10 MB OPFS cap, weak `persist()` on iOS, and WebView storage eviction make browser
storage unsafe as the system of record). Only ciphertext is written; the WebView still does all the
crypto, so zero-knowledge holds. Tracked in **#145**.

### The one app-side change this needs (handoff)

The web core is owned by the app, not by this folder, so wiring the backend in is an **app change**,
not a mobile-only one. It is a single line at the `new LocalRepo()` construction site in
`frontend/js/app.js`:

```js
import { NativePersistence, isNativeShell } from '<wherever this module is served from>';

const api = isNativeShell()
    ? new LocalRepo({ persistence: new NativePersistence() })
    : new LocalRepo();
```

Two open questions for that change (both for the app owner, deliberately not done here):

1. **Where the module is served from.** The WebView only serves `webDir` (`../frontend`), so to be
   importable at runtime `native-persistence.js` has to live under `frontend/` (e.g.
   `frontend/js/native-persistence.js`) or be exposed via an import map. This copy in `mobile/src/`
   is the source of truth; the app integration decides how it is served.
2. **The injection line** in `app.js` above.

## Conventions / decisions to confirm

- **App ID** is `app.wymber` (reverse of the `wymber.app` domain). It becomes the Android
  `applicationId` and the iOS bundle identifier, semi-permanent once a store listing exists, so
  confirm it before the first store submission (tracked under store readiness, **#149**).
- **App name** is `Wymber`.

## Roadmap

See [docs/mobile/roadmap.md](../docs/mobile/roadmap.md) and epic **#56**.
