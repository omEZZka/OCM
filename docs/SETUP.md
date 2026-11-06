# One-time setup

1. Push this repo to `lovereplit-bit/OCM` (branch `main`). The workflow in
   `.github/workflows/build.yml` builds on every push and publishes the APK to Releases.
   Release names look like `OpenCode-1.0.8-<code>.apk`; the app compares `<code>` for OTA.

2. Google sign-in (optional until you want it):
   - Google Cloud Console > APIs & Services > Credentials
   - Create an OAuth client of type **Web application**; copy its client ID into the repo secret `GOOGLE_WEB_CLIENT_ID`
   - Create a second OAuth client of type **Android** with package `app.opencodemob` and the SHA-1 printed by the
     "Signing key" step of the workflow run
   - Without the secret the app falls back to a local profile and says so on the login screen

3. Signing key: `keystore/release.jks` (alias `opencodemob`, password `opencodemob`) is committed so every build
   is signed identically and OTA updates install over each other. Anyone with that key can sign an APK that installs
   over yours, so for a public repo move it into secrets instead: set `KEYSTORE_BASE64` (base64 of the .jks) and
   `KEYSTORE_PASSWORD`, then delete the file from the repo. The workflow prefers the secrets.

4. Version: change `VERSION_NAME` in the workflow. The version code is `29887625 + run_number`, so every build
   stays above the 1.1.x upstream-client line that reached 29887625.

## What the build does

1. `scripts/build-runtime.sh` - proot as native libs, Ubuntu arm64 rootfs, newest stable opencode `v1.*`.
2. `scripts/fetch-ui-deps.sh` - marked, DOMPurify, highlight.js, xterm.js (pinned npm versions) and the file-type
   icons from the opencode repo at the same tag. Everything is vendored into the APK, so the UI needs no network.
3. Gradle builds, signs and the workflow publishes `OpenCode-<version>-<code>.apk` to Releases.

## Behaviour worth knowing

- 1.x only: the newest stable `v1.*` upstream release is baked in at build time, in-app core updates look only at
  `v1.*` tags, and `OPENCODE_DISABLE_AUTOUPDATE=1` stops the CLI from jumping to v2.
- Core updates (Settings > Updates > OpenCode core) swap the binary without reinstalling the APK.
- An APK update unpacks a fresh Linux rootfs, so packages the user installed with `apt` are reset. Everything in
  `/root` (sessions, auth, config, projects) lives outside the rootfs and is kept.
- Server log: `files/server.log` in the app's private storage.
