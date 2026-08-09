# Egress audit, Android build (#149)

**What this is.** A systematic account of every way bytes can leave the device in the Wymber
Android build, with a file-and-line citation for each claim. It exists to *earn* the Play
**Data Safety** declaration of "no data collected, no data shared" rather than assume it. That
declaration is a formal statement to Google and, in the US, a representation to users the FTC can
hold the publisher to, so it should rest on something checkable.

**Method.** Static source audit of this worktree at `docs/store-declarations`, performed 2026-08-09
against the tree at `origin/develop` (`0ae3696`). Full-tree content sweeps across `frontend/`
(including the vendored libraries and the service worker) and `mobile/` (manifest, Capacitor config,
Gradle files, Java sources, staging script). No build was run and no runtime network trace was
captured; see [Limits](#limits-of-this-audit) for exactly what that leaves open.

**Companion documents.** [`play-console-answers.md`](play-console-answers.md) turns this audit into
the console form answers. [`play-store-readiness.md`](play-store-readiness.md) is the account and
submission plan. [`../compliance-posture.md`](../compliance-posture.md) §2 makes the same
no-third-party claim at a higher level; this document is the evidence under it.

---

## Verdict

**The Wymber Android app initiates no network transmission of user data. There is no analytics,
telemetry, crash reporting, ad SDK, remote font, or CDN asset anywhere in the shipped build, and no
code path that sends vault contents anywhere.**

That verdict is clean, but it is not the whole picture, and the three qualifications below are the
part worth reading. None of them is a hidden transmission. All three are cases where the plain
sentence "nothing ever leaves the device" would be an overstatement if left unqualified.

| # | Qualification | Does the app transmit? | Affects the "no data collected" answer? |
|---|---|---|---|
| 1 | **User-initiated export via the OS share sheet** puts a file, sometimes plaintext, wherever the user sends it | No. The user picks the destination | No, but it needs the right form answer (see below) |
| 2 | **Android device-to-device (D2D) transfer** is not reliably disabled by `allowBackup="false"` on API 31+ | No. This is an OS flow between the user's own two devices | No |
| 3 | **An inert `com.google.gms:google-services` classpath** would activate Firebase the moment a `google-services.json` is added | No. Not active today | No, but it is a latent regression path |

---

## 1. The `allowBackup` answer

**The question asked:** is `allowBackup` set, and would the vault file be swept into a Google cloud
backup, meaning encrypted user data leaves the device without the user choosing it?

**The answer: no, cloud backup is off.**

```xml
<!-- mobile/android/app/src/main/AndroidManifest.xml:4-7 -->
<!-- allowBackup=false: OS auto-backup must not quietly copy app data (the vault is
     ciphertext, but backup here is deliberate and user-driven via export, see #147). -->
<application
    android:allowBackup="false"
```

`android:allowBackup="false"` at `AndroidManifest.xml:7` disables cloud-based Auto Backup to Google
Drive. **The vault is not swept into a Google cloud backup.** For the specific question this audit
was asked to settle, that is the definitive answer, and it is the answer the Data Safety form
depends on.

### The nuance the manifest comment does not cover

The app targets API 36 (`mobile/android/variables.gradle:4`), so Android 12+ behaviour applies, and
there `allowBackup` no longer controls one single thing. Google's own documentation:

> "For apps targeting Android 12 (API level 31) or higher, this behavior varies. On devices from
> some device manufacturers, specifying `android:allowBackup="false"` disables cloud-based backup
> and restore (such as Google Drive backups) but doesn't disable device-to-device transfers for the
> app."
>
> [developer.android.com/guide/topics/data/autobackup](https://developer.android.com/guide/topics/data/autobackup), "Enable and disable backup"

> "This format [`dataExtractionRules`] makes the difference between Google Drive backup and D2D
> transfer explicit by requiring you to specify include and exclude rules separately for cloud
> backups and for D2D transfer."
>
> [developer.android.com/about/versions/12/backup-restore](https://developer.android.com/about/versions/12/backup-restore)

**Neither `android:dataExtractionRules` nor `android:fullBackupContent` is set** anywhere in the
manifest, and `mobile/android/app/src/main/res/xml/` contains only `file_paths.xml`. So the D2D
path is not explicitly closed, and per Google's wording whether it is open "varies" by manufacturer.

**Where the vault actually sits.** `frontend/js/native-persistence.js:35` sets `DIRECTORY = 'DATA'`
(Capacitor `Filesystem` `Directory.Data`) and writes `wymber.vault` there. On Android that resolves
to the app's internal files directory, which is exactly the scope a backup or transfer would sweep
if not excluded. (This directory mapping is documented Capacitor behaviour but was **not** verified
against the primary source in this task; see [Limits](#limits-of-this-audit).)

**How much this matters, stated honestly.** Less than it first sounds, for three reasons:

1. D2D transfer moves data from the user's old phone to the user's new phone during setup, at the
   user's own initiation. It is not transmission to the developer or to a third party, and Google
   Drive is not involved. It does not make the "no data collected" answer untrue.
2. What would move is **ciphertext**. The vault is sealed before it is ever written
   (`mobile/README.md`, "Only ciphertext is written"), so a transferred vault still requires the
   user's password to open.
3. The biometric path would not survive the transfer anyway. `BiometricVaultPlugin.java` wraps the
   data-encryption key with an `AndroidKeyStore` key, and Keystore keys are non-exportable, so a
   transferred install would find its wrapped-DEK `SharedPreferences` blob present but the Keystore
   key gone, forcing password unlock.

So this is a **documentation-accuracy and hardening item, not an egress finding.** The in-repo
comments claim more than `allowBackup="false"` actually guarantees:

- `AndroidManifest.xml:4-5` says auto-backup "must not quietly copy app data", which is true for
  cloud backup and unproven for D2D.
- `frontend/js/native-persistence.js:33-34` says `Directory.Data` is "excluded from OS cloud backup
  **by default**". That reasoning is wrong even though the outcome is right: the app-internal files
  directory is *included* in Auto Backup by default, and it is `allowBackup="false"` that excludes
  it, not the choice of directory.

**Recommended follow-up (deliberately not done here, see [Boundaries](#boundaries)):** add an
`android:dataExtractionRules` resource with an explicit `<device-transfer>` exclusion, and, because
`minSdkVersion = 24` (`variables.gradle:2`), a matching `android:fullBackupContent` for pre-31
devices. That requires creating a new file under `mobile/android/app/src/main/res/xml/`, which is
outside this task's write scope, so it is filed as a recommendation rather than applied.

---

## 2. Web layer (`frontend/`)

The Capacitor WebView loads `frontend/` unchanged, staged into `mobile/www/` (`mobile/README.md`),
so the web layer *is* the app's behaviour.

### No outbound calls exist

Zero occurrences of `fetch(`, `XMLHttpRequest`, `sendBeacon`, `WebSocket`, `EventSource`, or
`navigator.connection` across every module in `frontend/js/` (`app.js`, `local-repo.js`,
`persistence.js`, `crypto.js`, `vault-store.js`, `analyze.js`, `utils.js`, `suggest.js`,
`tutorial.js`, `changelog.js`, `config.js`, `export.js`, `native-share.js`, `native-persistence.js`,
`native-biometric.js`).

The only `fetch(` in the entire `frontend/` tree is in the service worker (below). No `new Image()`
pixel requests. The one `.src =` assignment, `frontend/js/mindmap.js:65`, points at the same-origin
vendored `/static/libs/cytoscape.min.js`.

Worth naming because it looks like a network call and is not: `local-repo.js` exposes
`get/post/put/delete` and `export.js:104-139` calls `api.post`/`api.put`. That is the api-shaped
adapter over the in-memory vault (`CLAUDE.md`, "the api seam"), not HTTP. `local-repo.js` contains
no `fetch` or `XMLHttpRequest`.

### Service worker (`frontend/sw.js`)

- Precache list (`CORE`, lines 14-39): 21 entries, every one a same-origin static path.
- `if (url.origin !== self.location.origin) return;` (line 63). Cross-origin requests are not
  intercepted, cached, or logged.
- `if (url.pathname.startsWith('/api/')) return;` (line 64). `/api/` is never cached. Note this is
  currently defensive dead code: no frontend module fetches `/api/health` or any `/api/*` path.
- Both `fetch` call sites (lines 69, 85) run only after those two guards, so both are same-origin
  app-shell GETs. The worker has no code path that reads OPFS, IndexedDB, or the vault.

### No third-party assets

- `frontend/css/styles.css` contains no `@font-face`, no `@import`, and no `url(...)` at all. Fonts
  are a system stack only.
- No external `<script src>`, `<link rel="stylesheet">`, or `<iframe>` in `index.html` or `404.html`.
- All icons and images are local files referenced by same-origin paths.
- Keyword sweep for `analytics|gtag|google-analytics|segment|mixpanel|sentry|amplitude|hotjar|clarity|facebook.net|doubleclick` across all `.js` and `.html`: no matches.

### Vendored libraries (`frontend/libs/`)

`cytoscape.min.js` (434,276 bytes) is the only vendored library. No `fetch(`, `XMLHttpRequest`,
`sendBeacon`, or `WebSocket` anywhere in it. No `sourceMappingURL`. Three `http://` string literals
exist and all three are **inert license text** in bundled MIT attribution headers
(`engelschall.com`, `opensource.org/licenses/MIT`, `en.wikipedia.org/wiki/MIT_License`, lines 26-30).
No telemetry or version-check code. **Cytoscape does not phone home.**

### Outbound links, and forms

Every external `<a href>` in `frontend/index.html` requires a deliberate user tap and hands off to
the OS dialer, messaging app, or browser. None carries vault data.

| Line | Target | Kind |
|---|---|---|
| 56, 538 | `tel:988` | dialer |
| 56, 539 | `sms:988` | messaging |
| 56, 553 | `tel:911` | dialer |
| 546 | `sms:741741?&body=HOME` | messaging (Crisis Text Line) |
| 557 | `https://findahelpline.com` | browser, crisis resource |
| 506 | `https://github.com/Tamok/wymber` | browser, source |
| 307 | `https://zoignon.com` | browser, publisher credit |

All three `<form>` elements (`index.html:77`, `:113`, `:127`) have **no `action` attribute**;
submission is handled entirely by JS listeners. No HTTP form POST occurs, local or remote.

### Export and share: the one path where data can leave, by user choice

This is the honest qualification to "nothing ever leaves the device", and it is worth stating
precisely rather than glossing.

`frontend/js/export.js` offers three export formats:

| Function | Output | Encrypted? |
|---|---|---|
| `exportAsJSON` (line 8) | `wymber-export-<date>.json` | **No, plaintext map content** |
| `exportAsText` (line 32) | `wymber-export-<date>.txt` | **No, plaintext map content** |
| `exportVaultFile` (line 84) | `wymber-vault-<date>.wymber` | Yes, ciphertext |

On the web these go through `downloadBlob()` (`export.js:148-161`), a local blob URL and an
`<a download>` click, which never touches the network. **On the native shell** `downloadBlob()`
routes to `nativeSaveFile()` (`frontend/js/native-share.js:83-114`), which writes the file to the
app cache directory and passes it to the OS share sheet:

```js
// frontend/js/native-share.js:97-101
await share().share({
    title: filename,
    files: [uri],
    dialogTitle: 'Save or share your export',
});
```

If the user then picks Gmail or Drive from the chooser, the file leaves the device, and for the JSON
and text formats that file is **plaintext trauma content**.

This is not app-initiated transmission and not "collection" in any sense: the user asked to export,
the user chose the destination, and the app never sees or selects it. But an audit that said
"nothing leaves the device" full stop would be wrong, and the product's own copy should keep saying
what it already says (`docs/mobile/store-listing.md:36-38`), that the *encrypted backup* is the
portable one.

For how this maps onto the Data Safety form, see
[`play-console-answers.md`](play-console-answers.md) §"User-initiated export".

---

## 3. Native layer (`mobile/`)

### Manifest

Full manifest is 45 lines. Declared permissions, in full:

```xml
<!-- mobile/android/app/src/main/AndroidManifest.xml:42-43 -->
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.USE_BIOMETRIC" />
```

- **`INTERNET`** is required by the Capacitor WebView bridge to serve the app shell over the local
  `https` scheme (`capacitor.config.json`, `"androidScheme": "https"`). It is not used for egress:
  nothing in the app makes a network request. This is already pre-answered in
  `play-store-readiness.md:54-56`.
- **`USE_BIOMETRIC`** backs `BiometricVaultPlugin` (#146). Local only.
- No `ACCESS_NETWORK_STATE`, no location, no contacts, no storage permissions.

Components: `MainActivity` is `exported="true"` because it is the launcher activity (`MAIN` /
`LAUNCHER`, lines 22-25), with no deep-link or custom-scheme filters. `FileProvider` is
`exported="false"` (line 32), serving the share/export flow. No `service`, no `receiver`, no other
`provider`.

No `android:networkSecurityConfig` attribute and no `network_security_config.xml` anywhere, so the
OS default applies, which blocks cleartext at this target level.

### Capacitor configuration

```json
// mobile/capacitor.config.json
"server": { "androidScheme": "https" },
"android": { "allowMixedContent": false }
```

No `server.url`, no `hostname`, no `cleartext`, and critically **no `allowNavigation`** whitelist.
The WebView is not pointed at any remote origin and has no allowance to navigate to one.

### Plugins

Three runtime Capacitor plugins (`mobile/package.json:19-27`, matched in
`mobile/android/capacitor.settings.gradle:2-9`):

| Plugin | Version | Network-capable? |
|---|---|---|
| `@capacitor/core` | ^8.4.0 | No, the WebView bridge runtime |
| `@capacitor/filesystem` | ^8.1.2 | No, local file I/O (the vault) |
| `@capacitor/share` | ^8.0.1 | Invokes the OS `ACTION_SEND` chooser; see §2 |

`@capacitor/cli` is a devDependency and is not shipped. None of the three carries telemetry.

### Native source

Two Java files, both read end to end:

- `MainActivity.java` (14 lines): extends `BridgeActivity`, registers `BiometricVaultPlugin`. No
  network code.
- `BiometricVaultPlugin.java` (361 lines): `AndroidKeyStore` AES/GCM wrap and unwrap of the vault
  DEK behind `BiometricPrompt`, with state in app-private `SharedPreferences` (`PREFS =
  "wymber.biometric"`, line 57). No `HttpURLConnection`, no `OkHttp`, no socket, no I/O beyond
  Keystore and SharedPreferences.

### Staging script

`mobile/scripts/prepare-web.mjs` (22 lines) is a straight recursive copy of `frontend/` into
`mobile/www/` and `mobile/www/static/`. It injects nothing and modifies no file contents.

---

## 4. Build and dependency layer

### No analytics or crash reporting

No Firebase, Crashlytics, Sentry, Bugsnag, AppCenter, Mixpanel, Amplitude, or Segment dependency is
declared anywhere in `mobile/`. No Play Core or Play Integrity library. Declared app dependencies in
full (`mobile/android/app/build.gradle:63-73`):

```gradle
implementation fileTree(include: ['*.jar'], dir: 'libs')
implementation "androidx.appcompat:appcompat:$androidxAppCompatVersion"
implementation "androidx.biometric:biometric:1.1.0"          // BiometricVaultPlugin (#146)
implementation "androidx.coordinatorlayout:coordinatorlayout:$androidxCoordinatorLayoutVersion"
implementation "androidx.core:core-splashscreen:$coreSplashScreenVersion"
implementation project(':capacitor-android')
testImplementation "junit:junit:$junitVersion"               // test-only
androidTestImplementation "androidx.test.ext:junit:..."      // test-only
androidTestImplementation "androidx.test.espresso:espresso-core:..."  // test-only
implementation project(':capacitor-cordova-android-plugins')
```

### The inert Firebase activation path

```gradle
// mobile/android/build.gradle:11
classpath 'com.google.gms:google-services:4.4.4'
```

```gradle
// mobile/android/app/build.gradle:79-84
def servicesJSON = file('google-services.json')
if (servicesJSON.text) {
    apply plugin: 'com.google.gms.google-services'
}
```

**No `google-services.json` exists anywhere in the repository** (confirmed by full-tree glob), so
the plugin never applies and no Firebase SDK is pulled in. This is stock Capacitor Android template
boilerplate for future push notifications, not something added for Wymber, and it is **not a current
egress path**.

It is flagged because it is a live trip-wire: dropping a `google-services.json` into
`mobile/android/app/` would silently activate the Google Services plugin and, from that point,
Firebase's own initialization behaviour, without any further code change or review prompt. Given
that the "no data collected" declaration is a formal representation, that is a regression path worth
knowing about. If push notifications are never planned, removing line 11 and the `apply plugin`
block would close it. This is a `mobile/` build change outside this task's write scope, so it is a
recommendation, not an applied fix.

---

## Limits of this audit

Stated plainly, because an audit that hides its own gaps is worth less than one that names them.

1. **Static analysis only.** No build was run and no runtime network trace was captured. Static
   analysis cannot catch a call assembled dynamically from concatenated strings, though a sweep for
   that pattern (`'fe'+'tch'`, `window['fetch']`, and similar) found nothing. A live network trace
   against a running debug build would be a genuinely stronger check and is recommended before the
   production submission, not before internal testing.
2. **Transitive Gradle graph not resolved.** `./gradlew :app:dependencies` was deliberately not run.
   The declared dependencies are all AndroidX or Capacitor, none of which are known telemetry
   libraries, but the full transitive closure is not statically enumerable from the build files
   alone. That command would settle it definitively.
3. **`mobile/node_modules/` is not installed** in this worktree, so the three Capacitor plugins'
   own manifest fragments (any permissions or components they merge in) were not read directly. The
   app-level manifest audited above is the pre-merge source, not the merged output. Building once
   and reading `app/build/intermediates/merged_manifests/` would confirm the final permission set.
4. **Capacitor's `Directory.Data` path mapping was not verified from primary source.** It is
   asserted here from documented Capacitor behaviour. Confirm before relying on it for the backup
   analysis in §1.
5. **The D2D question is genuinely open**, not resolved. Google's documentation says the behaviour
   "varies" by manufacturer and gives no universal answer. This audit reports that ambiguity rather
   than resolving it.
6. **iOS is out of scope.** This audit covers the Android build only.

## Boundaries

Two hardening changes are recommended above and were deliberately **not** applied, because both fall
outside this task's write scope (`docs/mobile/` plus `AndroidManifest.xml` only):

- Adding `android:dataExtractionRules` + `android:fullBackupContent` resources (§1) requires new
  files under `mobile/android/app/src/main/res/xml/`.
- Removing the inert `google-services` classpath (§4) requires editing `mobile/android/build.gradle`
  and `mobile/android/app/build.gradle`.

`AndroidManifest.xml` was **not modified**: `allowBackup="false"` is correct as written and needs no
correction. The recommended manifest attribute additions are inseparable from the new resource files
they would reference, so both are left as a single follow-up.

Two documentation inaccuracies noted in §1 sit in files outside this scope
(`frontend/js/native-persistence.js:33-34`) and are reported rather than corrected.
</content>
</invoke>
