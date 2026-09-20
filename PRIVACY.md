# Privacy Policy — Omni-Revi-Transfer

**Last updated:** 2026-09-18 (plugin version 0.0.9b)

Omni-Revi-Transfer ("the plugin") is a [Decky Loader](https://github.com/SteamDeckHomebrew/decky-loader) plugin for the Steam Deck. It runs entirely on the user's own device. This document explains what data the plugin touches, how the optional Google Drive, Discord and Steam features work, and how to contact us.

## Summary

- The plugin does **not** operate any server of its own, does **not** collect analytics or telemetry, and does **not** send any data to the developer.
- All data the plugin handles (screenshots, settings) stays on the user's Steam Deck, except when the user explicitly chooses to share a screenshot (via the local QR feature, or the optional Google Drive, Discord or Steam integrations described below) or turns on the optional automatic upload.
- The developer has no access to, and never receives a copy of, any user's screenshots, Google account, or Google Drive contents.

## What the plugin accesses on the device

- **Steam's own screenshot files**, already saved locally by Steam itself (Steam button + R1/RB), under the standard `userdata/<account>/760/remote/<appid>/screenshots/` path. The plugin reads this folder to build the in-app gallery, and can delete a file from it only when the user explicitly taps "Delete" on that screenshot.
- **A local settings file** (storage-limit preference, auto-delete toggle, QR share duration, auto-upload and Steam upload preferences) stored inside the plugin's own Decky-managed settings directory on the Deck, plus, only if the user links them, an obfuscated Google session token and Discord webhook address, and the client ID/secret of the user's own Google and Discord apps if they enter them, in the same directory.
- Nothing outside of Steam's own screenshots folder and the plugin's own settings folder is read, written, or scanned.

## Share via QR (local network only)

When the user chooses "Share via QR" for a screenshot, the plugin starts a temporary local HTTP server on the Deck's own LAN address and shows a QR code (generated **entirely on-device**, with no third-party QR/analytics service involved) that a phone on the same Wi-Fi network can scan to download that one file. This server:

- Serves only the single screenshot the user selected, under a random, high-entropy, one-time filename — never the whole gallery.
- Shuts itself down automatically after the first successful download (with a short grace period) or after a short timeout if nobody downloads it.
- Never leaves the local network; no screenshot or file data is transmitted to the developer or to any third-party server.

## Google Drive integration (optional, off unless the user links it)

Omni-Revi-Transfer optionally lets a user upload a screenshot to **their own** Google Drive. This feature is entirely opt-in:

- **What we access:** the plugin requests only the [`drive.file`](https://developers.google.com/drive/api/guides/api-specific-auth) OAuth scope — the narrowest scope Google Drive offers. This scope only ever grants access to files and folders that this plugin itself creates in the user's Drive (organized under a `omni-revi-transfer/screenshots/<Game Name>` folder structure it creates on first upload). The plugin cannot see, list, read, or modify any other file already in the user's Drive.
- **What we upload:** only the specific screenshot file the user explicitly chooses to upload, at the moment they choose to upload it. Nothing is uploaded automatically or in the background unless the user turns on the optional Auto-upload setting described below.
- **Whose Google app:** the plugin ships no Google credentials. Each user creates their own Google Cloud project and OAuth client and enters its client ID and secret in the plugin, where they are stored only on the user's Steam Deck (obfuscated). The developer's Google project is not involved and the developer receives nothing.
- **Where the session is stored:** signing in uses Google's OAuth "device flow" (the user approves access on their own phone/browser, not by giving the plugin a password). Google then issues a long-lived refresh token, which is stored **locally on the user's own Steam Deck only** — never transmitted to the developer or to any server other than Google's own OAuth endpoints. That local file is obfuscated at rest (not left as human-readable plaintext) as a defense-in-depth measure against casual exposure, though this is disclosed to the user as obfuscation rather than strong encryption before they link their account, alongside an explicit warning about what a compromised device could mean for that saved session.
- **Revoking access:** the user can unlink Google Drive at any time from the plugin's Share options panel. This deletes the locally stored session and revokes the token with Google directly, exactly like removing an app from your [Google Account's connected apps list](https://myaccount.google.com/permissions).
- **No server-side component:** there is no backend server operated by the developer that ever sees, proxies, stores, or logs any user's screenshots, Google account information, or Drive contents. All communication is directly between the user's own Steam Deck and Google's own servers.

## Discord integration (optional, off unless the user links it)

Omni-Revi-Transfer optionally lets a user post a screenshot to a Discord channel of their choice:

- **What we access:** the plugin requests only the `webhook.incoming` OAuth scope. It lets Discord create a webhook in the one channel the user selects; it does not let the plugin read messages, servers, or any account information.
- **Whose Discord app:** likewise, each user creates their own Discord application and enters its ID and secret in the plugin; they stay on the user's Deck only.
- **What we store:** only the resulting webhook URL, on the user's own Steam Deck, obfuscated at rest (disclosed as obfuscation, not strong encryption, before linking). Discord's access token is discarded immediately and never stored. Nothing is sent to the developer.
- **What we upload:** only the screenshot the user explicitly chooses to send, plus its game name as the message text, directly from the Deck to Discord.
- **Revoking access:** "Unlink Discord" deletes the webhook on Discord and the local copy. The user can also delete the webhook at any time in the channel's Integrations settings, or remove the app under Discord's Authorized Apps.

## Steam sharing (optional)

The plugin can upload a screenshot the user chooses to **their own Steam account**, and can open a friend's Steam chat with a screenshot staged in it for the user to confirm. Both are performed by the user's own Steam client on their Deck, directly with Valve's services under the user's own Steam login; the plugin developer never receives the screenshots, the friends list, or any message. The plugin reads the user's Steam friends list and recent chats locally on the Deck only, to let them pick a recipient. Account uploads use the privacy level the user selects (Private by default), and the plugin cannot delete screenshots once they are uploaded to Steam. Staging a screenshot in a chat sends nothing until the user confirms it in Steam's own chat window.

## Optional automatic upload

For Steam, and for each linked service (Google Drive, Discord), the user can turn on an "Auto-upload" setting, **off by default**. While it is on, each new screenshot taken while the plugin is running is uploaded to that service after a delay the user chooses (5 to 60 seconds, 10 by default), without a per-screenshot confirmation. Screenshots that existed before the setting was turned on are never uploaded automatically. The setting can be switched off at any time, and unlinking a service switches it off. Uploads go directly from the user's Deck to the chosen service, as described in the sections above; nothing is sent to the developer.

## Installer (optional)

The optional Desktop Mode installer (`installer/`) is a shell script that runs on the user's own Deck. It downloads the plugin's release from GitHub (or uses a zip the user already has), asks the user for their administrator password through the system's standard prompt (never stored or sent anywhere), installs the plugin under Decky's plugins folder, and, only if the user chooses, saves the client ID and secret of their own Google / Discord app in the plugin's settings folder (obfuscated, on the Deck only). It keeps a local log at `~/.cache/omni-revi-transfer-installer.log`. It sends nothing to the developer.

## Data retention and deletion

- Screenshots are retained exactly as long as the user keeps them in Steam's own screenshots folder (or, in Google Drive, in the user's own Drive) — the plugin does not impose its own retention policy beyond the user's own configured, opt-in "auto-delete when over a storage limit" setting, which is off by default.
- Uninstalling the plugin removes its local settings and any locally stored Google session token, Discord webhook address and app credentials from the Deck. It does not delete the user's Steam screenshots or anything already uploaded to their Google Drive.

## Children's privacy

This plugin is a general-purpose utility for Steam Deck screenshot management and is not directed at children. It does not knowingly collect any personal information, from children or otherwise, since it collects no personal information at all — see "Summary" above.

## Changes to this policy

If this policy changes, the updated version will be published at this same URL in the plugin's GitHub repository, with the "Last updated" date above revised accordingly.

## Contact

For questions about this policy or the plugin's data handling, contact: **decky.universal.share@gmail.com**

Source code (fully open and auditable): https://github.com/Revivedx/omni-revi-transfer
