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

The full Android AI, script editor, writing archive and local model are not ported
in this desktop preview. No dedicated Suno section or automatic generation loop
is included. Regular Suno browsing is available subject to its login support.

## Pair the phone

1. Install the companion preview separately from your original browser.
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
camera/microphone/location permissions are denied in this preview. No desktop
userscripts, remote AI control, password autofill or passkey integration is claimed.
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
