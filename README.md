# Voodoo Browser for Windows

A personal desktop browser with a paired Android companion. Open it when needed;
closing the window stops browser processes and the phone link. No startup task,
tray service, telemetry, cloud account or recurring hosting bill is configured.

## Latest download — rolling updates

- [Latest Windows x64 preview ZIP](https://github.com/ether4o4/Voodoo-Browser-desktop/releases/download/desktop-preview/Voodoo-Browser-windows-x64.zip)
- [Release notes and SHA-256 checksums](https://github.com/ether4o4/Voodoo-Browser-desktop/releases/tag/desktop-preview)
- [Latest Android companion preview APK](https://github.com/ether4o4/Voodoo-Browser/releases/download/mobile-preview/Voodoo-Browser-mobile-preview.apk)

These download URLs stay the same as preview assets are updated. Extract the
Windows ZIP into its own folder and run **Voodoo.exe**. Keep all extracted files
together. The Windows build is unsigned. The Android preview uses the separate
`com.ether4o4.voodoo.dev` package; it does not replace or import the original app's
profile. A release update preserving that profile needs the original signing key.

## What works in this preview

- HTTPS tabs, navigation, search and a persistent website profile.
- A shared library of selected favorites, plain-text note snapshots and sent tabs.
- Private-network pairing over Wi-Fi or a phone hotspot, certificate-pinned TLS
  and authenticated AES-256-GCM messages. New pairing codes expire in five minutes.
- Incoming tabs wait for you to open them. Note snapshots preserve both devices'
  contributions instead of silently replacing a writing draft.
- Device revocation and explicit Link on/off. Every desktop launch starts with
  Link off; Android sync is on demand while the Device link screen is foreground.

Desktop 0.2.0 carries over the mobile 0.3.6 home, globe, script workbench and
writing archive. AI, provider connections, offline models and voice are deferred.

- **Workbench:** edit/import/export `.user.js` source, select saved scripts,
  check syntax, keep draft history, review permissions and source diffs, check
  updates, restore installed versions disabled, and block scripts per website.
- **Magic scripts:** discover Greasy Fork scripts for the current website,
  review source, browse all saved scripts, and use script commands. Results are
  shown 20 at a time; the bounded cache and cancellation prevent stale searches.
- **Activation:** choose exactly one of Save to scripts (inactive), Automatic
  (next matching document), or Manual (only after Activate). Saving never reloads
  or executes the current page. Manual activation confirms and reloads once.
- **Mobile UI:** the same responsive workbench, retrowave styles, five pin groups,
  workspace names and interactive globe. Persistent Workbench/Magic/Back to page
  navigation keeps drafts available. Hide navigation preserves the section bar.
- **Writing:** the existing mobile writing archive, protected lines, snapshots,
  rules and archive import/export. It is separate from shared note snapshots.

Scripts use separate Chromium isolated worlds with no website preload or Node.
The mobile supported GM subset includes values/listeners, DOM helpers, resources,
HTTPS requests, menus, reviewed downloads/clipboard/tab requests, and logs.
`@match`, `@include`, exclusions, `@noframes`, grants and `@connect` are enforced
natively. No unsafeWindow, website cookies, GM_cookie, Node or full Tampermonkey
compatibility is claimed. Unsupported APIs are reported before activation.
Disabling stops future automatic injection and native privileges; reload to
remove a script's existing DOM changes and user-created timers. Script updates
require source review and saving; they never install themselves.

Scripts and their GM values are encrypted separately from the shared library.
Backups include scripts, values, history, pins and writing, excluding website
logins and pairing secrets. Mobile JSON backups can be imported in Workbench
Settings; restored scripts start disabled. Scripts do not automatically sync over
Wi-Fi: the existing link still exchanges selected favorites, notes and tabs.
No dedicated Suno section or automatic generation loop is included.

## Pair the phone

1. Open the latest Android Voodoo app. The separate companion preview download
   above uses its own profile; keep your original app installed.
2. Put phone and PC on the same trusted Wi-Fi or phone hotspot.
3. In desktop **Device link**, start the link, select the PC's private-network
   address and create a pairing code. If Windows asks, allow only your trusted
   private network. Voodoo never changes firewall rules or forwards router ports.
4. In Android **Tools → Device link**, paste the code and pair. Keep that code
   private. Use **Sync now** to exchange shared items.
5. Use **Send tab** or add a favorite/note to share it. Open received tabs from
   the shared library. Both apps must be open for an exchange.

If the PC changes IP address, revoke the old pairing and pair again. Guest Wi-Fi,
VPN routing, hotspot client isolation or a firewall may prevent a connection.
An internet relay would be a separate opt-in feature; none is deployed here.

## Credential boundaries

**This is a development preview, not an independently audited password manager.**
Website cookies remain in the desktop's Chromium profile or the phone's WebView
profile. Cookies, passwords, provider API keys, full history and whole profiles
are not in the sync schema. Do not migrate high-value credentials to this preview.

The desktop library, pairing secrets and TLS private key are encrypted at rest
with Electron safeStorage/Windows DPAPI. It fails closed if protected storage is
unavailable. DPAPI does not protect against malicious software running as your
Windows user. Android pairing secrets use the existing Android Keystore store.

External web pages run sandboxed with no application preload or Node access.
Only the exact internal top-level page can use the app's narrow controls. Website
camera/microphone/location permissions are denied in this preview. Remote AI control, password autofill and passkey integration are deferred.
Some websites reject embedded browser sign-in. Keep a mature browser/password
manager available for those accounts. Browser-engine updates require a new build;
there is no automatic updater yet.

## Build and verify

Use a supported Node version (24.15+ LTS or 26+) and Windows for OS-storage checks.

```powershell
npm ci
npm test
npm run test:app
npm start
npm run package
```

The app uses Electron 45.1.0. Production dependencies are pinned in package-lock.
Automated verification covers data validation, encryption/tamper rejection, replay
protection, pairing expiry/revocation, immutable merge, renderer data escaping,
untrusted-page boundaries, Windows protected storage and app shutdown. See the
rolling release for the exact checks executed and remaining device-test limits.

The familiar globe artwork comes from the owner's Android Voodoo project. Its
existing browser/profile data is never copied as part of packaging.

## Update an existing Windows copy

Close Voodoo, extract the complete new ZIP to its own folder, and launch
`Voodoo.exe`. The application identity and Windows user-data location are unchanged;
your existing website profile, shared library and pairings are retained. Do not
remove the Windows user-data folder. No installer or uninstall step is required.

Mobile UI/assets are based on `ether4o4/Voodoo-Browser` source
`7a8f74cb9154a93d7ab8744b69ebe15091a9a51b` (0.3.6). The desktop runtime and
bridge are native Electron adaptations. Third-party notices are under
`renderer/mobile/licenses` and `renderer/mobile/vendor`.
