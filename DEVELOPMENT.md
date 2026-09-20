# Development

How to build, test on a Deck and publish a release. If you just want to use the plugin, see the [README](README.md).

## Setup

`npm install`, then put your Deck's connection info in a root-level `settings.json` (gitignored):

```json
{ "deckIP": "192.168.x.x", "deckPort": "22", "deckUser": "deck", "deckPass": "..." }
```

**Credentials for your own dev copy (optional).** Copy `google_credentials.example.json` to `google_credentials.json` and `discord_credentials.example.json` to `discord_credentials.json` (both gitignored) and fill in your app's client ID and secret (create the apps as in the README's setup guides). Deploying uploads them when present, so your Deck needs no setup. Keys entered inside the plugin take priority over these files, and the placeholder values from the examples are ignored.

## Commands

| Command | What it does |
|---|---|
| `npm run deploy` | Builds, stops `plugin_loader` on the Deck, uploads the plugin over SFTP and restarts it. (Stopping first avoids a hot-reload race that can leave a runaway plugin process; see `scripts/deploy.mjs`.) |
| `npm run deploy -- --no-credentials` | Deploys like a fresh public install, to test the in-plugin "Set up" flow. |
| `npm run build` / `npm run watch` | Compile only. |
| `npm run package` | Builds the **public** zip `release/omni-revi-transfer-vX.Y.Z.zip` (no credentials) and copies the installer files next to it. |
| `npm run package:personal` | Builds `...-personal.zip` with your credentials for your own devices. **Never publish it.** It refuses to build if a credentials file is missing. |

The zip is made with `archiver` instead of the official [decky CLI](https://github.com/SteamDeckHomebrew/cli) (Linux/macOS only), which is equivalent because the plugin has no native backend to compile.

## Personal build

To run the plugin on your own devices (another Deck, or another Linux PC with Decky Loader) with your credentials already inside, use `npm run package:personal`. It bundles your gitignored `google_credentials.json` and `discord_credentials.json` into `omni-revi-transfer-vX.Y.Z-personal.zip`, so nothing has to be set up on the target. Install it with Decky's *Install Plugin from ZIP*, or `omni-revi-transfer-installer.sh install --zip <file>`. **Never publish it**: it contains your secrets. The public build (`npm run package`) never contains credentials.

## Dependencies

**Runtime (bundled into `dist/index.js`):**
| Package | Why |
|---|---|
| [`@decky/api`](https://www.npmjs.com/package/@decky/api) | Frontend↔backend RPC (`callable`, events), plugin registration |
| [`@decky/ui`](https://www.npmjs.com/package/@decky/ui) | Steam-styled UI components (panels, buttons, sliders, modals) |
| [`react-icons`](https://www.npmjs.com/package/react-icons) | Icons (camera, arrows, refresh) |
| [`qrcode-generator`](https://www.npmjs.com/package/qrcode-generator) | Fully local, dependency-free QR code rendering |
| `tslib` | TypeScript helper runtime |

**Recordings:** `ffmpeg`, which SteamOS ships and the plugin runs as a program (it is not bundled and not a Python package). Without it, recordings are listed but cannot be shared or saved as MP4.

**Backend:** Python standard library only (`asyncio`, `socket`, `secrets`, `shutil`, `json`, `re`, `base64`, `hashlib`, `ssl`, `urllib.request`/`urllib.parse`) plus the `decky` module Decky Loader itself provides. No pip packages are vendored.

**Dev tooling:**
| Package | Why |
|---|---|
| `rollup` + `@decky/rollup` | Bundles `src/index.tsx` into `dist/index.js` |
| `typescript` | Type checking |
| `node-ssh` | Powers `scripts/deploy.mjs`, our own SSH/SFTP deploy script (see Commands above) |
| `archiver` | Powers `scripts/package.mjs`, builds the distributable install zip |

## Publishing a release

1. Bump `version` in `package.json`, add the entry to `CHANGELOG.md`, and refresh the **Latest update** section of the README and the version and date in `PRIVACY.md`.
2. `npm run package`.
3. Create a GitHub Release tagged `vX.Y.Z` and attach **three files** from `release/`: `omni-revi-transfer-vX.Y.Z.zip`, `Omni-Revi-Transfer-Installer.desktop` and `omni-revi-transfer-installer.sh`. The installer looks for an asset named `omni-revi-transfer-v*.zip` in the latest release, and the `.desktop` fetches the script from the `main` branch when it isn't next to it.
4. **Never** attach the `-personal` zip: it contains your OAuth credentials.
