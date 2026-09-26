// Uploads the already-built plugin (dist/, plugin.json, main.py, py_modules/,
// package.json) to the Decky Loader plugins folder on the Steam Deck via
// SFTP/SSH, and restarts the plugin_loader service so it goes live.
//
// Reads credentials from /settings.json at the project root (deckIP,
// deckPort, deckUser, deckPass). That file is NOT committed to the repo
// (see .gitignore).

import { NodeSSH } from "node-ssh";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function loadJSON(relPath) {
  return JSON.parse(readFileSync(path.join(rootDir, relPath), "utf-8"));
}

// `--device NAME` deploys to another machine listed in settings.NAME.json (same fields as
// settings.json, gitignored), e.g. `npm run deploy -- --device bazzite`.
const deviceIndex = process.argv.indexOf("--device");
const device = deviceIndex > -1 ? process.argv[deviceIndex + 1] : null;
const settings = loadJSON(device ? `settings.${device}.json` : "settings.json");
const pluginMeta = loadJSON("plugin.json");

const {
  deckIP,
  deckPort = "22",
  deckUser,
  deckPass,
  deckDir = "/home/deck",
} = settings;

const pluginName = pluginMeta.name;
const remotePluginDir = `${deckDir}/homebrew/plugins/${pluginName}`;

// Local files/folders that make up the installable plugin.
const itemsToUpload = [
  { local: "dist", remote: "dist", type: "dir" },
  { local: "plugin.json", remote: "plugin.json", type: "file" },
  { local: "main.py", remote: "main.py", type: "file" },
  { local: "package.json", remote: "package.json", type: "file" },
];
if (existsSync(path.join(rootDir, "py_modules"))) {
  itemsToUpload.push({ local: "py_modules", remote: "py_modules", type: "dir" });
}
// Gitignored (see .gitignore) -- only present locally, uploaded so main.py
// can load the Google OAuth client id/secret from next to itself on the Deck.
// `--no-credentials` deploys like a public install (users enter their own credentials in the
// plugin) and removes any copies left from earlier deploys, to exercise the "Set up" flow.
const skipCredentials = process.argv.includes("--no-credentials");
if (!skipCredentials && existsSync(path.join(rootDir, "google_credentials.json"))) {
  itemsToUpload.push({ local: "google_credentials.json", remote: "google_credentials.json", type: "file" });
}

if (!skipCredentials && existsSync(path.join(rootDir, "discord_credentials.json"))) {
  itemsToUpload.push({ local: "discord_credentials.json", remote: "discord_credentials.json", type: "file" });
}

async function main() {
  if (!deckIP || !deckUser || !deckPass) {
    throw new Error(
      "Incomplete settings.json: deckIP, deckUser and deckPass are required."
    );
  }

  const ssh = new NodeSSH();
  console.log(`Connecting to ${deckUser}@${deckIP}:${deckPort}...`);
  await ssh.connect({
    host: deckIP,
    port: Number(deckPort),
    username: deckUser,
    password: deckPass,
  });

  // The service is stopped before uploading: uploading while Decky is
  // running makes its file-watcher fire a hot-reload for every individual
  // file (one for dist/, plugin.json, main.py...), and a `systemctl restart`
  // in the middle of that churn can leave a plugin process orphaned mid-
  // reload (happened to us once: an orphan like that ended up using 12GB of RAM).
  console.log("Stopping plugin_loader...");
  await runSudo(ssh, deckPass, "systemctl stop plugin_loader");

  // The plugins folder is owned by root; grant ourselves permission before writing.
  await runSudo(ssh, deckPass, `mkdir -p "${remotePluginDir}"`);
  await runSudo(ssh, deckPass, `chown -R ${deckUser}:${deckUser} "${remotePluginDir}"`);

  console.log(`Uploading files to ${remotePluginDir} ...`);
  for (const item of itemsToUpload) {
    const localPath = path.join(rootDir, item.local);
    if (!existsSync(localPath)) {
      console.warn(`  skipped (missing): ${item.local}`);
      continue;
    }
    if (item.type === "dir") {
      await ssh.putDirectory(localPath, `${remotePluginDir}/${item.remote}`, {
        recursive: true,
        concurrency: 4,
      });
    } else {
      await ssh.putFile(localPath, `${remotePluginDir}/${item.remote}`);
    }
    console.log(`  ✔ ${item.local}`);
  }

  if (skipCredentials) {
    await runSudo(ssh, deckPass, `rm -f "${remotePluginDir}/google_credentials.json" "${remotePluginDir}/discord_credentials.json"`);
    console.log("  (--no-credentials: bundled credential files removed from the Deck)");
  }

  console.log("Starting plugin_loader...");
  await runSudo(ssh, deckPass, "systemctl start plugin_loader");

  ssh.dispose();
  console.log("Deploy complete.");
}

async function runSudo(ssh, password, command) {
  const result = await ssh.execCommand(`echo '${password}' | sudo -S ${command}`);
  if (result.code !== 0) {
    throw new Error(`Remote command failed "${command}":\n${result.stderr}`);
  }
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
