# Omni-Revi-Transfer — for Decky

**What the plugin does:** Omni-Revi-Transfer is a plugin for the Steam Deck (installed through [Decky Loader](https://github.com/SteamDeckHomebrew/decky-loader)) that lets you browse, manage and share the screenshots and game recordings your Deck already makes, right from the in-game Quick Access Menu: send them to your phone with a QR code, to your Steam account or a Steam friend, to a Discord channel, or to your own Google Drive, without ever leaving your controller.

## Latest update — v1.0.1

- **Desktop fix**: on a PC, choosing an option in a dropdown no longer closes the open panel or shows the old value.
- **Re-encoded videos keep the game's real frame timing**, so they look as smooth as the recording.
- **Safety net for video export**: it is stopped if it would use too much memory, instead of risking the whole computer.
- Also tested on a desktop PC running Bazzite with Decky Loader, not only on the Deck.

Version 1.0.0 (previous update):

- **Recordings**: the clips saved with Steam's game recording get their own list, with the same **Share** (QR, Google Drive, Discord) and **Delete** as screenshots, plus **Save MP4 to Videos**.
- **Video export**: choose how a recording becomes an MP4, from an instant copy to a much smaller re-encode, and let Discord videos shrink to fit the server's size limit.
- **Auto-upload dropdown**: per service, choose Off, screenshots only, recordings only, or both.
- **Storage for recordings**: its own limit, alerts and optional auto-delete; the alerts repeat for every new file while you are over the limit.

From 1.0 on, updates are hotfixes. Everything, release by release, is in the [CHANGELOG](CHANGELOG.md).

## What it does

- **Screenshots and preview**: every game's Steam screenshots (plus "SteamOS / Desktop" shots), newest first, 5 per page. Open one for a full-size preview with **Share** and **Delete**. Non-Steam games show the name you gave them.
- **Recordings**: the clips saved with Steam's own game recording, newest first, 5 per page, with the game, length and size. Open one for its preview with **Share** and **Delete**. It needs `ffmpeg`, which SteamOS ships.
- **Share** (dropdown in the preview):
  - **QR Code**: a phone on the same Wi-Fi scans it and downloads the file (iPhone and Android alike). Nothing leaves your network.
  - **Steam (my account)** *(screenshots only)*: uploads it to your Steam account with the privacy you pick (Private by default).
  - **Steam friend (chat)** *(screenshots only)*: pick a friend (recent chats first) and their chat opens with the screenshot ready to send, like Steam's own Media → Share. You can tag it as a spoiler; **B** goes back to the friend list.
  - **Discord**: posts it, with the game name, to a channel you choose. A video is shrunk to fit your Discord size limit.
  - **Google Drive**: uploads it to `omni-revi-transfer/screenshots/<Game>` or `omni-revi-transfer/recordings/<Game>` in your own Drive; re-uploading the same file is skipped.
  - **Save MP4 to Videos** *(recordings only)*: writes the video to your Videos folder, optionally in a folder per game.
- **Auto-upload** (off by default): in **Share options**, Steam, Google Drive and Discord each get a dropdown (**Off**, **Screenshots only**, **Recordings only**, **Screenshots and recordings**; Steam only takes screenshots) and a delay slider (5-60 s, 10 by default). It only covers files created while the plugin runs, never the ones you already had. A recording is sent once Steam has finished writing it.
- **Video export**: how a recording becomes an MP4 when it is shared or saved.
  - **Quality**: **Original** joins Steam's pieces without re-encoding (instant, big file); **Smaller** and **Smallest** re-encode to H.264 (a 27-second clip went from 24 MB to about 3 MB and 1.7 MB).
  - **Maximum resolution** (as recorded, 720p, 480p), **Encoder** (software, or the Deck's hardware encoder), **Crop to 16:9**, **Discord size limit** (10, 25, 50, 100 MB or never shrink) and **A folder per game**.
  - Re-encoding uses CPU and memory, and the panel says roughly how much (about 1.5-2 cores and up to ~170 MB while it runs, ~0.4 s per second of video). It runs at low priority, but avoid it for auto-upload if you play demanding games.
- **Storage panel**: how much space your screenshots and your recordings use, each with a warning limit (0.5-50 GB or Unlimited; 10 GB for recordings by default) and alerts at 80/90/100%. An optional, off-by-default "auto-delete oldest when over the limit" exists for each, and warns that it deletes from *any* game (for recordings it never deletes the newest clip). While you stay over a limit without auto-delete, the alert repeats for every new screenshot or clip.
- **Share options**: link or unlink Google Drive and Discord, choose the Steam upload privacy, and set how long a QR link stays active.

## Why it works this way

- **It uses Steam's own screenshots and recordings** (Steam button + R1, and Steam's game recording): the plugin reads and manages what Steam already saves, and finds your Steam account and folders by itself, including multi-account setups.
- **A recording is turned into an MP4 only when needed.** Steam keeps a clip as separate video and audio pieces, so sharing one joins them with `ffmpeg` into a temporary file that is deleted right after it is sent. Big files are streamed, never loaded into memory.
- **QR sharing is a tiny LAN-only server** written on `asyncio`, because the Python that Decky bundles has no `http.server`. It serves only the chosen file, under a random name.
- **Discord goes to a channel, never a DM.** Discord offers no legitimate way for an app to post or DM *as you* (that would be a self-bot). The allowed route is a webhook in a channel you pick, linked through the Deck's Steam browser. For a "DM to myself", create a private server with one channel.
- **Steam sharing runs inside Steam's own client**, since only it can upload to your account. The friend chat uses Steam's internal chat, which isn't a documented API and could change with a Steam update; if it stops working, the plugin falls back to just opening the chat.
- **You bring your own Google / Discord app**, so there is no shared secret to leak or to be rate limited or revoked for everyone at once.
- **Storage limits are warnings, not walls.** Steam has no setting or API that lets a plugin stop it from saving a screenshot or a clip, and locking its folders makes it fail silently (it was tried on a Deck: empty clip entries and unfinished video were left behind). So a limit warns you, repeats the warning for each new file, and can optionally delete the oldest.
- **The screenshot list is cached per folder**, so opening the menu and auto-upload checks stay instant even with 20,000 screenshots (measured on a Deck: ~0.6 ms per gallery refresh instead of ~358 ms).

## Download and install

Everything is on the [Releases page](https://github.com/Revivedx/omni-revi-transfer/releases/latest). Choose **one** of the two ways:

| | **Installer** (`.desktop`) | **ZIP** (manual) |
|---|---|---|
| File to download | `Omni-Revi-Transfer-Installer.desktop` | `omni-revi-transfer-vX.Y.Z.zip` |
| Where | Desktop Mode, double-click | Game Mode: Decky → Settings → Developer → *Install Plugin from ZIP* |
| Needs Decky's Developer Mode | No | Yes |
| Update / uninstall | From the same menu | Install the new zip over it / remove it in Decky |
| Entering your Google Drive / Discord keys | **Easy**: a "Configure keys" menu, also offered right after installing | **Harder**: only inside the plugin with the on-screen keyboard, or by creating the credential files by hand |
| Recommended | **Yes** | If you prefer not to run a script |

The installer is recommended because the keys are long strings that are tedious to type with the Deck's on-screen keyboard. Either way, Decky Loader must already be installed ([decky.xyz](https://decky.xyz)).

**Installer, step by step**

1. In **Desktop Mode**, download `Omni-Revi-Transfer-Installer.desktop`.
2. Right-click it → **Properties → Permissions** → tick **Is executable**, then double-click it. (Browsers don't download files as executable; if KDE asks whether to trust the launcher, launch it.)
3. Pick **Install**. It asks for the Deck's password once (the one you use for `sudo`; if you never set one, it tells you how) and then offers to enter your Google Drive and Discord keys. You can skip both and do it later with **Configure keys**, which appears once the plugin is installed.
4. Back in **Game Mode**, the plugin is in the Quick Access menu.

The installer only touches `~/homebrew/{plugins,settings,data,logs}/Omni-Revi-Transfer` and restarts Decky's `plugin_loader`. It is a plain shell script (`installer/omni-revi-transfer-installer.sh`) you can read first, it also works from a terminal (`status | install | configure | uninstall`), and it keeps a log in `~/.cache/omni-revi-transfer-installer.log`. If a release zip sits next to it or in `~/Downloads`, it uses that instead of downloading.

**ZIP, step by step**: download `omni-revi-transfer-vX.Y.Z.zip`, enable **Developer Mode** in Decky's settings, then in its **Developer** tab choose **Install Plugin from ZIP**.

**Need your Google Drive or Discord keys?** QR, Steam sharing, the gallery and the storage panel work without any setup. Google Drive and Discord need one you create yourself, and the guides below explain it step by step: [Setting up Google Drive](#setting-up-google-drive) (about 10 minutes) and [Setting up Discord](#setting-up-discord) (about 5).

## Setting up Google Drive

One time, best done on a computer:

1. Open the [Google Cloud Console](https://console.cloud.google.com/) and create a project (any name).
2. **APIs & Services → Library**, search for **Google Drive API** and click **Enable**.
3. **Google Auth Platform** (older UI: *OAuth consent screen*) → **Get started**: any app name, your email as support and contact address, audience **External**.
4. **Data access → Add or remove scopes**: add only `.../auth/drive.file` and save.
5. **Audience → Publish app** (status "In production"). Without this, Google expires the login every 7 days and only listed test users can link. `drive.file` is a non-sensitive scope, so publishing your own app for your own use needs no Google review. If Google shows an "unverified app" notice while you link, that is your own app: continue.
6. **Clients → Create client**, type **TVs and Limited Input devices**, and copy the **Client ID** and **Client secret**.
7. Enter them with the installer's **Configure keys**, or in the plugin: **Share options → Google Drive → Set up Google Drive**.
8. **Link Google Drive** → confirm the Deck's password → scan the QR with your phone and approve.

Alternative to typing the ~70-character client ID: in Desktop Mode (or over SSH) create `google_credentials.json` in the plugin folder (`~/homebrew/plugins/Omni-Revi-Transfer/`) with the shape of `google_credentials.example.json`. Values entered in the plugin take priority over that file.

## Setting up Discord

One time:

1. Open the [Discord Developer Portal](https://discord.com/developers/applications) and create a **New Application** (any name).
2. **OAuth2 → Redirects → Add Redirect**: `http://localhost:47821/callback`, then **Save Changes** (without saving it isn't stored).
3. Copy the **Application ID** (General Information) and, under OAuth2, **Reset Secret** and copy the **Client Secret**.
4. Enter them with the installer's **Configure keys**, or in the plugin: **Share options → Discord → Set up Discord**.
5. **Link Discord**: the authorization page opens in the Deck's Steam browser; log in (Discord's QR login works), then pick the server and channel. You need a server where you can manage webhooks; a private server of your own works as a "DM to myself" (Discord's **+ → Create My Own**).

No Discord review is needed for the `webhook.incoming` scope.

## Security

The short version, since the usual worry is someone getting hold of your keys. More detail in [PRIVACY.md](PRIVACY.md).

- **Your keys never leave your Deck.** Your Google / Discord app keys and your linked sessions are stored only in the plugin's settings folder on your Deck (private to the system). There is no server and no telemetry, and the developer receives nothing.
- **Nothing secret ships with the plugin.** The release and this repository contain no credentials: every user creates their own app, so there is no shared secret to steal, and GitHub's push protection blocks accidental commits of one.
- **Honest limit: obfuscated, not encrypted.** Saved keys and sessions are scrambled with a key derived from the Deck itself. That stops casual snooping (a copied or accidentally opened file), but not someone with root access to your Deck, because the plugin itself has to read them. Even then, a stolen client ID and secret alone can't reach your accounts, since access still has to be approved by you, and you can reset the secret any time in Google or Discord.
- **Linking needs the Deck's password**, so someone who picks up your unlocked Deck can't attach their own account.
- **Minimum access, revocable any time.** Google: only `drive.file`, meaning files the plugin creates, never the rest of your Drive. Discord: only `webhook.incoming`, meaning it can post into the one channel you pick and can't read anything. Steam sharing goes through your own Steam client. **Unlink** in the plugin revokes the token with Google or deletes the Discord webhook; you can also use your [Google connected apps](https://myaccount.google.com/permissions) or the channel's Integrations settings.
- **Sharing safeguards.** A QR link is a random one-time address, only on your local network, serving only that file, and it closes after the download or the timeout (anyone on your Wi-Fi with that exact address could fetch it meanwhile). Auto-upload is off by default and has no filter: it uploads whatever you screenshot or record, and the delay is your window to delete it first. The temporary MP4 made from a recording is deleted as soon as it has been sent. Steam uploads count against your Cloud space and the plugin can't delete them; the **Public** privacy makes them visible on your profile.
- **The installer** is a readable shell script, asks for your password once, and only touches the plugin's folders.

## Credits

The video export options (quality steps, copying the audio, cropping 16:10 to 16:9, folders per game) were inspired by [decky-video-uploader](https://github.com/SootyOwl/decky-video-uploader) by SootyOwl (BSD-3-Clause), a plugin that exports Steam's recordings to MP4 and uploads them to YouTube. I read its README and source to see how it handles Steam's recording format and its export quality levels, and no code was copied. If you want YouTube uploads, use that plugin.

## Development

Building from source, deploying to a Deck, personal builds, the dependency list and publishing a release are covered in [DEVELOPMENT.md](DEVELOPMENT.md).
