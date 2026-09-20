# Changelog

All notable changes to Omni-Revi-Transfer are documented in this file. Format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.0.0] - 2026-09-20

The plugin now covers everything it was meant to. From here on, releases are hotfixes.

### Added
- **Recordings.** A new **Recordings** list, next to **Screenshots** (the old "Gallery"), shows the clips saved with Steam's own game recording: newest first, five per page, with the game name, length and size. Each one has the same **Share** and **Delete** as a screenshot. Share offers **QR Code**, **Google Drive** (`omni-revi-transfer/recordings/<Game>`), **Discord** and **Save MP4 to Videos**. Steam cannot take a video, so the Steam options are not offered. Steam stores a clip as separate video and audio pieces, so it is turned into one `.mp4` with the `ffmpeg` that SteamOS ships. That file only exists while it is being sent and is deleted afterwards.
- **Video export panel** (under Storage): **Quality** (Original joins the pieces without re-encoding; Smaller and Smallest re-encode to H.264), **Maximum resolution** (as recorded, 720p, 480p), **Encoder** (software x264, or the Deck's hardware encoder with a fallback to software), **Crop to 16:9** for recordings made at the Deck's 16:10 shape, **Discord size limit** (10, 25, 50 or 100 MB, or never shrink) and **A folder per game** for Save MP4. A clip that would exceed the Discord limit is re-encoded to fit; one too long to fit at a watchable quality is refused with a clear message. Warning labels state the approximate RAM and CPU a re-encode uses, for manual sharing and for auto-upload.
- **Auto-upload of recordings.** Each auto-upload service now has a dropdown: **Off**, **Screenshots only**, **Recordings only** or **Screenshots and recordings** (Steam only takes screenshots). A new clip is uploaded once Steam has finished writing it, after the delay chosen for that service; clips that already existed are never uploaded. Existing on/off toggles carry over as "Screenshots only".
- **Storage for recordings.** The Storage panel has a second block with its own warning limit (default 10 GB), alerts at 80/90/100% and an optional auto-delete that removes the oldest clips first and never the newest one. The temporary MP4 files and videos saved to the Videos folder are not counted. Recordings are also checked in the background, every 10 seconds, because a clip can be saved at any time.
- **Repeated alert while over the limit.** Steam keeps saving files whatever a plugin says, so when a limit is exceeded and auto-delete is off, the alert is now repeated for each new screenshot or clip instead of only the first time. These alerts, and the auto-delete notice, now appear while the Quick Access Menu is closed (before, only while it was open). Screenshots also apply the limit right when Steam reports a new one.

### Changed
- **Gallery** is now **Screenshots**.
- Large files are streamed instead of loaded into memory: Google Drive uses its resumable upload above 4 MB, Discord sends the file in blocks, and the QR server sends in blocks and supports `Range` requests, so a recording of hundreds of MB does not raise the plugin's memory.
- Re-encoding runs at low priority on one thread with a short look-ahead, and the audio is copied unchanged. Measured on a Deck with a 27 s 720p clip, that used about 55% less CPU time and 44% less memory (about 170 MB) than two threads, for a slightly smaller file.
- A clip folder Steam leaves without any video (which happens when it cannot record) is hidden instead of listed.
- Plugin footprint at idle on a Deck: about 18 MB PSS (39 MB RSS) with auto-upload on, against about 16 MB (37 MB) in 0.0.9b.

### Credits
- The export quality steps (x264 quality and speed presets, copying the audio, cropping 16:10 to 16:9, folders per game) were inspired by [decky-video-uploader](https://github.com/SootyOwl/decky-video-uploader) by SootyOwl (BSD-3-Clause), which reads Steam's recordings and exports them to MP4 and YouTube. No code was copied.

### Notes
- **No hard storage limit.** Stopping Steam from saving once a limit is reached is not possible from a plugin: Steam has no setting or API for it. Making its recording folders read-only was tried on a Deck, and Steam then failed without telling the user, leaving empty clip entries or unfinished video behind. The limits are therefore a warning plus an optional auto-delete.

## [0.0.9b] - 2026-09-20

### Fixed
- Screenshots of non-Steam games showed as "Game (<id>)" in the gallery, in the Google Drive folder name and in the Discord message. The plugin now reads the game's name from Steam's `shortcuts.vdf`, matching the screenshot folder by the shortcut's id.
- Google Drive: a game's folder was remembered by id only, so after deleting a folder in Drive (or after a game's name got resolved) uploads kept going to the old, trashed folder and no new folder appeared. Folders are now remembered per game name, and a folder that was deleted or trashed is detected and created again.

### Changed
- The Google Drive link screen shows the code in much larger type, next to the QR.

## [0.0.9] - 2026-09-18

> Version 0.0.8 was an internal test version that was never published; everything it contained is included here.

### Added
- **Desktop Mode installer** (`installer/`): a `.desktop` launcher plus a shell script with a small menu: **Install / Update**, **Configure keys** (only offered once installed), and **Uninstall**. It downloads the latest release (or uses a zip next to it / in Downloads), asks for the Deck's password once, restarts Decky's plugin service, and optionally saves the user's own Google Drive / Discord keys in the plugin's own obfuscated format. Also usable from a terminal (`status`, `install`, `configure`, `uninstall`). `npm run package` copies the installer files into `release/` for publishing.
- **Discord sharing**: link a Discord channel from Share options (OAuth `webhook.incoming`, completed in the Deck's Steam browser through a `localhost` callback) and post screenshots to it from the Share dropdown. Includes the same sudo-password confirmation as Google Drive, obfuscated storage of the webhook, single-use `state` protection, mentions disabled on posts, and webhook deletion on unlink. Posts to a channel only; Discord offers no legitimate way to DM as the user.
- **Steam sharing**: "Steam (my account)" uploads a screenshot to the user's Steam account with a chosen privacy (Private by default, or Friends only / Unlisted / Public), and "Steam friend (chat)" picks a friend from a searchable list (recent chats first, with profile pictures) and opens their chat with the screenshot staged, the same way Steam's own Media → Share → friend does, so the spoiler tag and confirmation happen in Steam's chat. Pressing B while the screenshot is unsent closes the chat and returns to the friend picker. It uses Steam's internal chat store (undocumented, so feature-checked, falling back to just opening the chat). New **Share options → Steam** block for the account upload privacy.
- **Auto-upload** toggles in Share options for Steam, Google Drive and Discord (Drive and Discord shown only while linked, all off by default; Steam is triggered by Steam's own screenshot notification instead of folder polling): new screenshots are uploaded after a per-service delay chosen with a slider (5–60 seconds, 10 by default), with a toast reporting the result. Existing screenshots are never uploaded, toggles are re-checked at upload time, and unlinking a service switches its toggle off.
- `discord_credentials.example.json`, and a `DISCORD_ENABLED` flag with the same release-zip gating as Google credentials.
- `PRIVACY.md` and README sections for Discord.

### Changed
- **README rewritten to be shorter and focused** (about 45% fewer words): the intro says what the plugin does, a "Latest update" section replaces the version line and points here for the full history, and "What it does" and "Why it works this way" are condensed to what matters to users. The obsolete design notes (early custom-capture attempts, the iCloud and Reddit explanations, the modal internals, and a wrong claim that the backend runs as the normal user) and the separate "Google Drive status" section are gone, and the four security sections became one "Security" section answering the practical worry (can someone get my keys?). Download and install comes before the setup guides for Google Drive and Discord. The developer-facing parts (deploy commands, credentials for a dev copy, publishing steps) moved to a new `DEVELOPMENT.md` (together with the personal-build notes and the dependency list), and the list of unused template files was dropped.
- **Performance** (measured on a real Deck): the screenshot folders are no longer walked in full every 2 seconds and several times per menu open. A cached, per-folder index (re-reading only folders whose timestamp changed, with a guard for coarse-timestamp SD cards) now backs the gallery, storage checks and auto-delete; the Drive/Discord auto-upload watcher scans nothing while its toggles are off and finds new files by timestamp when on; game names are cached; `urllib.request` and the certificate bundle load on first use instead of at startup; settings sliders save after a short pause instead of on every step; and Steam auto-upload reads a light config endpoint instead of the full settings. With 20,000 screenshots, a gallery refresh went from ~358 ms to ~0.6 ms and the watcher from ~218 ms per check to ~0.02 ms; the plugin's resident memory at startup went from 38.8 MB to 36.7 MB (PSS 16.1 to 14.9 MB).
- **Share options reorganized** into three blocks: QR Link, Google Drive and Discord. The two services are collapsible and hold their own link/unlink button and auto-upload options.
- **Google Drive and Discord use each user's own credentials.** The release ships no OAuth client id/secret: **Share options → Google Drive / Discord → Set up** asks for the user's own app's client ID and secret (validated, stored on the Deck obfuscated, resettable), and the README has step-by-step guides ("Setting up Google Drive", "Setting up Discord"). This removes any shared secret from the distributed zip and makes the plugin independent of Google's brand verification of the developer's app (`github.io` isn't accepted as an owned domain, so that verification cannot complete). Google Drive and Discord stay enabled (`GOOGLE_DRIVE_ENABLED` / `DISCORD_ENABLED` = True).
- **Public and personal builds.** `npm run package` builds the public zip and never includes credentials (it refuses if one slips in); `npm run package:personal` builds `...-personal.zip` with the developer's gitignored credentials for their own devices and refuses to build if a file is missing. `npm run deploy -- --no-credentials` deploys like a fresh install to test the setup flow. Credential files still work next to `main.py`, with values entered in the plugin taking priority, and the placeholders in the `*.example.json` files are ignored.
- Manual upload logic for Drive and Discord moved into shared functions used by both the Share menu and auto-upload.
- Token storage helpers (`_load_obfuscated_json` / `_save_obfuscated_json`) are now shared between Google Drive and Discord.

### Fixed
- Games installed on a microSD card (or any other Steam library folder) showed up as "Game (<appid>)" instead of their name, because only the internal library's `steamapps` was searched. Every library listed in `libraryfolders.vdf` is now checked, which also fixes the game-name folder used for Google Drive uploads and the Discord message text.

### Removed
- The "iCloud (coming soon)" placeholder in the Share menu. Apple offers no public API to upload into a user's iCloud Drive/Photos from a third-party app off Apple platforms; the rationale is documented in the README's design decisions. Share via QR remains the way to send screenshots to iPhones.

## [0.0.5b] - 2026-09-18

### Changed
- Renamed the project from "Decky Universal Share" to **Omni-Revi-Transfer — for Decky** (GitHub repo, package/plugin names, in-app title, docs, and the Google Drive upload folder path).

## [0.0.5a] - 2026-09-18

### Added
- Google Drive upload from the screenshot preview's Share menu, organized under `decky-universal-share/screenshots/<Game Name>` (or `SteamOS` for shots taken outside a game) at the time of this release — see [0.0.9](#009---2026-09-18) above for the later folder-path rename, with duplicate-upload detection.
- Google OAuth device-flow linking (scan a QR, approve on your phone) with a step-up sudo-password confirmation gate before a link can start, and an explicit on-screen disclosure of what a compromised Deck could mean for the saved session.
- At-rest obfuscation (not full encryption, disclosed as such) for the locally stored Google session token.
- "Unlimited" option for the storage warning limit, alongside the existing 0.5–50 GB range.
- Storage usage alerts that fire once per threshold crossing at 80/90/100%.
- `PRIVACY.md`, written to support Google's OAuth app verification process.
- `npm run package` / `scripts/package.mjs`: builds a distributable install `.zip` for manual sideloading, with no build tools required on the installing end.
- `google_credentials.example.json`: documents the shape of the (gitignored) local file main.py loads Google OAuth credentials from.

### Changed
- Google OAuth client id/secret moved out of `main.py` into a gitignored `google_credentials.json`, loaded at runtime, since GitHub's push protection flags OAuth secrets in public repos.
- `scripts/package.mjs` only bundles `google_credentials.json` into the release zip once `GOOGLE_DRIVE_ENABLED` is `True`, so the real secret never ships inside a public release artifact while the feature is off.
- Storage and Share options panels are now collapsible, and the current storage limit is shown as a prominent sentence above the slider.
- Screenshot preview modal rebuilt on `ModalRoot` instead of `ConfirmModal`, so the controller's B button only closes the preview and never triggers Delete.
- Password fields (the sudo confirmation prompt) are now properly masked and submit on Enter.
- Project metadata (`package.json`, `plugin.json`, `LICENSE`) fully rebranded from the original decky-plugin-template placeholders.

### Fixed
- Auto-delete and storage-alert logic now correctly skip enforcement entirely when the limit is set to Unlimited, instead of risking treating "0 MB" as a real (and catastrophic) limit.

### Known limitations
- Google Drive is implemented but shipped **disabled** (`GOOGLE_DRIVE_ENABLED = False`) pending Google's OAuth app verification — see `README.md`'s "Google Drive status" section.

## [0.0.1] - 2026-09-17

### Added
- Initial release: gallery of Steam's native screenshots (5 per page, Previous/Next), full-resolution preview, Delete.
- Local, LAN-only "Share via QR" with a locally generated QR code, one-time random filename, and automatic shutdown after download or timeout.
- Storage panel with a configurable warning limit (0.5–50 GB) and an opt-in, off-by-default auto-delete-oldest toggle.
- Automatic Steam account/screenshot-folder detection (single and multi-account).
