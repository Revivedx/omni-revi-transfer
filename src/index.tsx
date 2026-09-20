import {
  Button,
  ButtonItem,
  DropdownItem,
  Focusable,
  ModalRoot,
  Navigation,
  PanelSection,
  PanelSectionRow,
  showModal,
  SliderField,
  staticClasses,
  TextField,
  ToggleField,
} from "@decky/ui";
import {
  addEventListener,
  removeEventListener,
  callable,
  definePlugin,
  toaster,
} from "@decky/api"
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FaArrowDown, FaArrowUp, FaCamera, FaSyncAlt } from "react-icons/fa";
import qrcode from "qrcode-generator";

interface ScreenshotItem {
  filename: string;
  path: string;
  appName: string;
  modified: number;
  thumbnail: string;
}

interface ScreenshotPage {
  total: number;
  offset: number;
  limit: number;
  items: ScreenshotItem[];
}

interface Settings {
  max_storage_mb: number;
  auto_delete: boolean;
  qr_share_duration_seconds: number;
  auto_upload_google_drive: boolean;
  auto_upload_discord: boolean;
  auto_upload_delay_google_drive: number;
  auto_upload_delay_discord: number;
  auto_upload_steam: boolean;
  auto_upload_delay_steam: number;
  steam_upload_privacy: number;
  used_mb: number;
  over_limit: boolean;
  account_detected: boolean;
}

// The few settings the Steam upload needs; fetching just these avoids the
// full get_settings() (which also runs the storage checks) for every screenshot.
interface SteamAutoUploadConfig {
  auto_upload_steam: boolean;
  auto_upload_delay_steam: number;
  steam_upload_privacy: number;
}

interface ShareResult {
  url: string | null;
  error: "invalid_path" | "server_failed" | null;
}

interface GoogleDriveStatus {
  linked: boolean;
  // Whether an OAuth client (the user's own, or one bundled in a personal build) is available to link with.
  configured?: boolean;
  credentials_source?: "user" | "bundled" | null;
}

interface GoogleDriveLinkStart {
  verification_url?: string;
  verification_url_complete?: string;
  user_code?: string;
  interval: number;
  expires_in: number;
  error: "start_failed" | "not_configured" | "disabled" | null;
}

interface GoogleDriveLinkPoll {
  status: "pending" | "success" | "expired" | "error";
}

interface GoogleDriveUploadResult {
  ok: boolean;
  error: "invalid_path" | "not_linked" | "upload_failed" | "duplicate" | null;
}

interface DiscordStatus {
  linked: boolean;
  configured?: boolean;
  credentials_source?: "user" | "bundled" | null;
}

interface CredentialsResult {
  ok: boolean;
  error: "invalid_id" | "invalid_secret" | "linked" | "disabled" | null;
}

interface DiscordLinkStart {
  auth_url: string | null;
  error: "disabled" | "not_configured" | "port_busy" | null;
  expires_in?: number;
}

interface DiscordLinkPoll {
  status: "idle" | "pending" | "success" | "denied" | "expired" | "error";
}

interface DiscordUploadResult {
  ok: boolean;
  error: "invalid_path" | "not_linked" | "upload_failed" | "too_large" | "rate_limited" | null;
}

const getScreenshots = callable<[offset: number, limit: number], ScreenshotPage>("get_screenshots");
const getScreenshotImage = callable<[path: string], string | null>("get_screenshot_image");
const deleteScreenshot = callable<[path: string], boolean>("delete_screenshot");
const getSettings = callable<[], Settings>("get_settings");
const setSettings = callable<[settings: Partial<Settings>], Settings>("set_settings");
const getSteamAutoUploadConfig = callable<[], SteamAutoUploadConfig>("get_steam_auto_upload_config");
const startQrShare = callable<[path: string, durationSeconds: number], ShareResult>("start_qr_share");
const stopQrShare = callable<[], void>("stop_qr_share");
const getGoogleDriveStatus = callable<[], GoogleDriveStatus>("google_drive_status");
const verifySudoPassword = callable<[password: string], boolean>("verify_sudo_password");
const startGoogleDriveLink = callable<[], GoogleDriveLinkStart>("start_google_drive_link");
const pollGoogleDriveLink = callable<[], GoogleDriveLinkPoll>("poll_google_drive_link");
const unlinkGoogleDrive = callable<[], void>("unlink_google_drive");
const uploadScreenshotToDrive = callable<[path: string], GoogleDriveUploadResult>("upload_screenshot_to_drive");
const getDiscordStatus = callable<[], DiscordStatus>("discord_status");
const setGoogleCredentials = callable<[clientId: string, clientSecret: string], CredentialsResult>("set_google_credentials");
const clearGoogleCredentials = callable<[], CredentialsResult>("clear_google_credentials");
const setDiscordCredentials = callable<[clientId: string, clientSecret: string], CredentialsResult>("set_discord_credentials");
const clearDiscordCredentials = callable<[], CredentialsResult>("clear_discord_credentials");
const startDiscordLink = callable<[], DiscordLinkStart>("start_discord_link");
const pollDiscordLink = callable<[], DiscordLinkPoll>("poll_discord_link");
const cancelDiscordLink = callable<[], void>("cancel_discord_link");
const unlinkDiscord = callable<[], void>("unlink_discord");
const uploadScreenshotToDiscord = callable<[path: string], DiscordUploadResult>("upload_screenshot_to_discord");

// --- Steam sharing ---------------------------------------------------------
//
// Unlike Google Drive / Discord, these run in the frontend: uploading a
// screenshot to the user's Steam account and messaging a friend are things
// Steam's own client does, reachable only through SteamClient / Steam's
// internal stores, not from our Python backend.
//
// - Account upload: SteamClient.Screenshots.UploadLocalScreenshot (typed and
//   part of the client API decky plugins commonly use).
// - Friend message: repeats what Steam's own Media > Share > friend does.
//   It opens that friend's chat window and stages the image in it
//   (ChatView.SetFileToUpload), where the user confirms, and can tag it as a
//   spoiler, before sending. Nothing is uploaded to the user's account. This
//   goes through Steam's internal chat store (window.g_FriendsUIApp), which is
//   NOT a documented API and can change with any Steam update, so every use
//   is feature-checked and a change degrades to opening the plain chat.

// Steam's EUCMFilePrivacyState values: 2 private, 4 friends only, 16 unlisted, 8 public.
const STEAM_PRIVACY_OPTIONS = [
  { data: 2, label: "Private (only you)" },
  { data: 4, label: "Friends only" },
  { data: 16, label: "Unlisted (anyone with the link)" },
  { data: 8, label: "Public" },
];

const STEAM_SHARE_AVAILABLE =
  typeof SteamClient !== "undefined" && typeof SteamClient.Screenshots?.UploadLocalScreenshot === "function";

// Steam's screenshot record has more fields than @decky/ui's typings list.
interface SteamScreenshotInfo {
  nAppID: number;
  hHandle: number;
  ePrivacy: number;
  bUploaded: boolean;
  strUrl: string;
  publishedFileID?: string;
}

interface SteamFriend {
  accountid: number;
  steamid64: string;
  name: string;
  avatarUrl?: string;
}

interface SteamUploadOutcome {
  ok: boolean;
  fileId?: string;
  privacy?: number;
  alreadyUploaded?: boolean;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const isRealFileId = (id?: string): id is string => !!id && id !== "0";

async function listSteamScreenshots(): Promise<SteamScreenshotInfo[]> {
  return (await SteamClient.Screenshots.GetAllAppsLocalScreenshots()) as unknown as SteamScreenshotInfo[];
}

// Steam identifies screenshots by (appid, handle); our gallery only has the
// file name, which Steam's own record ends with ("screenshots/<app>/screenshots/<file>").
async function findSteamScreenshotByFilename(filename: string): Promise<SteamScreenshotInfo | undefined> {
  return (await listSteamScreenshots()).find((s) => s.strUrl.endsWith("/" + filename));
}

async function uploadSteamScreenshot(shot: SteamScreenshotInfo, privacy: number): Promise<SteamUploadOutcome> {
  if (shot.bUploaded && isRealFileId(shot.publishedFileID)) {
    return { ok: true, fileId: shot.publishedFileID, privacy: shot.ePrivacy, alreadyUploaded: true };
  }
  const accepted = await SteamClient.Screenshots.UploadLocalScreenshot(String(shot.nAppID), shot.hHandle, privacy);
  if (!accepted) return { ok: false };
  // Steam finishes the upload in the background; wait (up to ~10 s) for the published id to appear.
  for (let attempt = 0; attempt < 20; attempt++) {
    const fresh = (await listSteamScreenshots()).find((s) => s.nAppID === shot.nAppID && s.hHandle === shot.hHandle);
    if (fresh && fresh.bUploaded && isRealFileId(fresh.publishedFileID)) {
      return { ok: true, fileId: fresh.publishedFileID, privacy: fresh.ePrivacy };
    }
    await sleep(500);
  }
  return { ok: true };
}

// Friends you chatted with recently come first (like Steam's own picker),
// then everyone else alphabetically.
function listSteamFriends(): SteamFriend[] {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const all: any[] = (window as any).friendStore?.allFriends ?? [];
  const recentChats: any[] = (window as any).g_FriendsUIApp?.ChatStore?.GetRecentChats?.() ?? [];
  /* eslint-enable @typescript-eslint/no-explicit-any */
  const recentRank = new Map<number, number>();
  recentChats.forEach((chat, index) => {
    if (typeof chat.accountid_partner === "number" && !recentRank.has(chat.accountid_partner)) {
      recentRank.set(chat.accountid_partner, index);
    }
  });
  return all
    .filter((f) => f.is_friend)
    .map((f) => ({
      accountid: f.accountid as number,
      steamid64: String(f.steamid64),
      name: String(f.display_name ?? f.accountid),
      avatarUrl: (f.persona?.avatar_url_medium ?? f.persona?.avatar_url) as string | undefined,
    }))
    .sort((a, b) => {
      const ra = recentRank.get(a.accountid) ?? Infinity;
      const rb = recentRank.get(b.accountid) ?? Infinity;
      return ra !== rb ? ra - rb : a.name.localeCompare(b.name);
    });
}

// Uploads to the user's account, then reports the outcome with a toast.
// Returns the outcome so callers (the friend flow) can reuse the file id.
async function shareToSteamAccount(item: ScreenshotItem, privacy: number): Promise<SteamUploadOutcome> {
  try {
    const shot = await findSteamScreenshotByFilename(item.filename);
    if (!shot) {
      toaster.toast({ title: "Steam can't find this screenshot", body: "Steam may not have indexed it yet. Try again in a moment." });
      return { ok: false };
    }
    toaster.toast({ title: "Uploading to Steam...", body: item.filename });
    const outcome = await uploadSteamScreenshot(shot, privacy);
    if (!outcome.ok) {
      toaster.toast({ title: "Steam upload failed", body: "Steam didn't accept the upload." });
    } else if (outcome.alreadyUploaded) {
      toaster.toast({ title: "Already on your Steam account", body: item.filename });
    } else {
      toaster.toast({ title: "Uploaded to your Steam account", body: item.filename });
    }
    return outcome;
  } catch (e) {
    console.error("Omni-Revi-Transfer: Steam upload failed", e);
    toaster.toast({ title: "Steam upload failed", body: "Check the console for details." });
    return { ok: false };
  }
}

// Gamepad B button, as reported by SteamClient.Input (ControllerInputGamepadButton.GAMEPAD_BUTTON_B).
const GAMEPAD_BUTTON_B = 1;

// While the screenshot is staged in the chat, B means "cancel": close that
// chat tab and hand control back (to the friend picker). B only does this
// while the chat tab is still open AND the screenshot is still waiting to be
// sent; once it's sent, the chat closed, or a few minutes pass, the watcher
// removes itself, so a later B press elsewhere is never hijacked.
/* eslint-disable @typescript-eslint/no-explicit-any */
function watchStagedChatForCancel(app: any, context: any, chat: any, view: any, onCancel: () => void): void {
  const uiStore = app.UIStore;
  const startedAt = Date.now();
  let sawFile = false;
  let finished = false;
  let registration: { unregister: () => void } | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;

  const isChatOpen = () => !!uiStore.GetTabSetByUniqueID(uiStore.GetPerContextChatData(context), chat.unique_id);
  // The file is picked up asynchronously, so just after staging it may not be visible yet.
  const isStaged = () => {
    const staged = view.m_fileUploadManager?.file;
    if (staged) sawFile = true;
    return !!staged || (!sawFile && Date.now() - startedAt < 5000);
  };
  const finish = () => {
    if (finished) return;
    finished = true;
    if (timer) clearInterval(timer);
    registration?.unregister();
  };

  timer = setInterval(() => {
    if (!isChatOpen() || !isStaged() || Date.now() - startedAt > 10 * 60 * 1000) finish();
  }, 500);

  registration = SteamClient.Input.RegisterForControllerInputMessages((_controllerIndex, button, pressed) => {
    if (finished || !pressed || (button as number) !== GAMEPAD_BUTTON_B) return;
    if (!isChatOpen() || !isStaged()) {
      finish();
      return;
    }
    finish();
    uiStore.CloseTabByID(chat.unique_id);
    onCancel();
  });
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// `onCancel` runs if the user backs out (B) from the chat with the
// screenshot still unsent; it's used to reopen the friend picker.
async function shareToSteamFriend(item: ScreenshotItem, friend: SteamFriend, onCancel: () => void): Promise<void> {
  try {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const app = (window as any).g_FriendsUIApp;
    /* eslint-enable @typescript-eslint/no-explicit-any */
    const chat = app?.ChatStore?.GetFriendChat(friend.accountid);
    if (!chat || typeof app?.UIStore?.ShowAndOrActivateChat !== "function") {
      throw new Error("Steam's chat isn't reachable");
    }

    const dataUri = await getScreenshotImage(item.path);
    if (!dataUri) throw new Error("couldn't read the screenshot");
    const blob = await (await fetch(dataUri)).blob();
    const file = new File([blob], item.filename, { type: blob.type || "image/jpeg" });

    // The app id Steam files the image under; it's the folder name in .../remote/<appid>/screenshots/.
    const appId = Number(/remote[\\/](\d+)[\\/]screenshots/.exec(item.path)?.[1] ?? 0);

    // The first argument of ShowAndOrActivateChat is Steam's own browser
    // context object (pid + UI mode), NOT a DOM window. Passing anything else
    // makes Steam create a stray chat context that floats over everything and
    // never gets the controller's focus, so use the one Steam registered.
    const context = app.GetDefaultBrowserContext?.() ?? app.UIStore.GetAllBrowserContexts?.()[0];
    if (!context) throw new Error("no Steam chat context");
    let view = app.UIStore.ShowAndOrActivateChat(context, chat, true);
    if (typeof view?.GetChatView === "function") view = view.GetChatView();
    if (typeof view?.SetFileToUpload !== "function") throw new Error("the chat can't take a file");
    view.SetFileToUpload(file, { unAssociatedAppID: appId });

    watchStagedChatForCancel(app, context, chat, view, onCancel);
    toaster.toast({ title: `Chat with ${friend.name} is open`, body: "Confirm the screenshot there to send it, or press B to go back." });
  } catch (e) {
    console.error("Omni-Revi-Transfer: staging the screenshot in Steam chat failed", e);
    // Fall back to just opening the chat, so the user can attach it by hand.
    try {
      SteamClient.WebChat.ShowFriendChatDialog(friend.steamid64);
    } catch (openError) {
      console.error("Omni-Revi-Transfer: opening the Steam chat failed too", openError);
    }
    toaster.toast({
      title: "Couldn't attach the screenshot",
      body: "Steam's chat changed or isn't reachable; the chat was opened instead.",
    });
  }
}

const PAGE_SIZE = 5;

// Feature flag: mirrors GOOGLE_DRIVE_ENABLED in main.py (true in releases).
// Both flags must match; set both to false to ship a build without Drive.
const GOOGLE_DRIVE_ENABLED = true;

// Same idea for Discord (mirrors DISCORD_ENABLED in main.py).
const DISCORD_ENABLED = true;

// Generated 100% locally (no calls to any external service) so nobody's
// share URL is exposed to a third party. `qrcode-generator` is a
// dependency-free library that runs inside the plugin's own bundle.
function qrCodeDataUrl(text: string): string {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  return qr.createDataURL(6, 8);
}

const DURATION_OPTIONS = [
  { data: 60, label: "1 minute" },
  { data: 300, label: "5 minutes" },
  { data: 600, label: "10 minutes" },
  { data: 1800, label: "30 minutes" },
];

// Uniform 0.5 GB steps from 0.5 up to 50 GB, plus one extra step for
// Unlimited at the end. The SliderField itself just moves over plain
// integer indices into this array -- that's the one thing about it we're
// fully certain works, so the "which GB value is this position" logic lives
// here instead of in slider props whose exact notch/step behavior we can't
// visually verify ourselves.
// 0 is the shared backend sentinel for "no limit" (see main.py).
const STORAGE_LIMIT_UNLIMITED = 0;
const STORAGE_LIMIT_VALUES_GB: number[] = [
  ...Array.from({ length: 100 }, (_, i) => Math.round((0.5 + i * 0.5) * 10) / 10), // 0.5 .. 50
  STORAGE_LIMIT_UNLIMITED, // Unlimited, always last
];
const STORAGE_LIMIT_LAST_INDEX = STORAGE_LIMIT_VALUES_GB.length - 1;

// Fuller sentence shown prominently above the slider, e.g.
// "2.5 GB limit set" / "No limit set".
function storageLimitDescription(gb: number): string {
  return gb === STORAGE_LIMIT_UNLIMITED ? "No limit set" : `${gb} GB limit set`;
}

// Compact form used in the collapsed summary button, e.g. "2.5 GB" / "Unlimited".
function storageLimitShort(gb: number): string {
  return gb === STORAGE_LIMIT_UNLIMITED ? "Unlimited" : `${gb} GB`;
}

// No notchLabels here: we tried labeling both endpoints and 5 GB
// checkpoints, and neither rendered reliably (checkpoints showed up at the
// wrong spot, e.g. "50 GB" as "5 GB"; even the two endpoints didn't show at
// all on a retry) -- SliderField's real notch-placement logic lives in
// Steam's own bundle, not something we can inspect or trust here. The exact
// current value is shown prominently above the slider instead, driven
// directly by the saved setting rather than by notch positioning.

function storageLimitIndexForMb(maxStorageMb: number): number {
  if (maxStorageMb === 0) return STORAGE_LIMIT_LAST_INDEX;
  const gb = maxStorageMb / 1024;
  let bestIndex = 0;
  let bestDiff = Infinity;
  for (let i = 0; i < STORAGE_LIMIT_LAST_INDEX; i++) {
    const diff = Math.abs(STORAGE_LIMIT_VALUES_GB[i] - gb);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestIndex = i;
    }
  }
  return bestIndex;
}

// Same size footprint as the image in the preview, so switching from the
// image PiP to the share PiP doesn't feel like a size jump.
const PIP_CONTENT_HEIGHT = "30vh";

const SHARE_METHOD_OPTIONS = [
  { data: "qr", label: "QR Code" },
  ...(STEAM_SHARE_AVAILABLE
    ? [
        { data: "steam", label: "Steam (my account)" },
        { data: "steamfriend", label: "Steam friend (chat)" },
      ]
    : []),
  ...(GOOGLE_DRIVE_ENABLED ? [{ data: "googledrive", label: "Google Drive" }] : []),
  ...(DISCORD_ENABLED ? [{ data: "discord", label: "Discord" }] : []),
];

// ModalRoot is used instead of ConfirmModal: the latter always forces its
// own visible OK/Cancel buttons with no documented way to hide them, AND --
// the real bug -- it doesn't close itself when they're pressed; you have to
// explicitly call the `.Close()` that showModal() returns. ModalRoot forces
// no buttons at all, and its `onCancel` prop is exactly what the B button fires.
function openShareModal(item: ScreenshotItem, onDeleted: () => void) {
  const modal = showModal(
    <ShareModalContent
      item={item}
      onGoBack={() => {
        modal.Close();
        openPreview(item, onDeleted);
      }}
      onStopped={() => {
        modal.Close();
        toaster.toast({ title: "Sharing stopped", body: item.filename });
      }}
    />
  );
}

// The share server lives in the backend, not tied to this modal's lifecycle.
// Closing this window (to go check the phone) must NOT shut it down -- that's
// why there's no stopQrShare() on unmount. It only shuts down via its own
// timer, after a download (with a grace period), or if the user presses
// "Stop sharing now" by hand.
function ShareModalContent({
  item,
  onGoBack,
  onStopped,
}: {
  item: ScreenshotItem;
  onGoBack: () => void;
  onStopped: () => void;
}) {
  const [starting, setStarting] = useState(true);
  const [shareUrl, setShareUrl] = useState<string | undefined>();
  const [downloaded, setDownloaded] = useState(false);

  const qrDataUrl = useMemo(() => (shareUrl ? qrCodeDataUrl(shareUrl) : undefined), [shareUrl]);

  useEffect(() => {
    let cancelled = false;
    getSettings().then((settings) => {
      if (cancelled) return;
      startQrShare(item.path, settings.qr_share_duration_seconds).then((result) => {
        if (cancelled) return;
        setStarting(false);
        if (result.url) {
          setShareUrl(result.url);
        } else {
          toaster.toast({ title: "Couldn't start sharing", body: "Check the plugin log" });
        }
      });
    });
    return () => {
      cancelled = true;
    };
  }, [item.path]);

  // The backend gives a grace period after the first download instead of
  // shutting down instantly (in case the phone needs another request to
  // finish saving the image) — this just reflects the notice on screen.
  useEffect(() => {
    const listener = addEventListener<[]>("qr_share_downloaded", () => setDownloaded(true));
    return () => removeEventListener("qr_share_downloaded", listener);
  }, []);

  const onStop = async () => {
    await stopQrShare();
    onStopped();
  };

  return (
    <ModalRoot onCancel={onGoBack} closeModal={onGoBack} bHideCloseIcon={false}>
      <div
        style={{
          minHeight: PIP_CONTENT_HEIGHT,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: "8px" }}>Share via QR</div>

        {starting && <div>Starting...</div>}

        {shareUrl && (
          <div style={{ textAlign: "center" }}>
            {qrDataUrl && <img src={qrDataUrl} alt="QR code" style={{ width: "180px", height: "180px" }} />}
            <div style={{ fontSize: "0.7em", opacity: 0.7, wordBreak: "break-all", margin: "4px 0" }}>
              {shareUrl}
            </div>
            {downloaded ? (
              <div style={{ color: "#4caf50", marginBottom: "8px" }}>
                ✓ Downloaded — stays active briefly in case you need it again, then stops on its own.
              </div>
            ) : (
              <div style={{ fontSize: "0.7em", opacity: 0.6, marginBottom: "8px" }}>
                Scan on a phone on the same Wi-Fi to download. Pressing B keeps sharing running
                until it's downloaded or it times out.
              </div>
            )}
            <ButtonItem layout="below" onClick={onStop}>
              Stop sharing now
            </ButtonItem>
          </div>
        )}
      </div>
    </ModalRoot>
  );
}

// OAuth device flow: Google gives us a short code plus a verification URL.
// Rather than asking the user to type the code, the QR encodes
// `verification_url_complete` (the code pre-filled) so approving is just
// "scan with your phone, tap allow" — no typing on the Deck at all. This
// polls poll_google_drive_link() on the interval Google itself specifies.
function GoogleDriveLinkModal({ onLinked, onClose }: { onLinked: () => void; onClose: () => void }) {
  const [state, setState] = useState<"starting" | "waiting" | "success" | "expired" | "error">("starting");
  const [info, setInfo] = useState<GoogleDriveLinkStart | undefined>();
  const [startError, setStartError] = useState<GoogleDriveLinkStart["error"]>(null);

  useEffect(() => {
    let cancelled = false;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      const result = await pollGoogleDriveLink();
      if (cancelled) return;
      if (result.status === "pending") {
        pollTimer = setTimeout(poll, (info?.interval ?? 5) * 1000);
      } else if (result.status === "success") {
        setState("success");
        onLinked();
      } else {
        setState(result.status === "expired" ? "expired" : "error");
      }
    };

    startGoogleDriveLink().then((result) => {
      if (cancelled) return;
      if (result.error || !result.user_code) {
        setStartError(result.error);
        setState("error");
        return;
      }
      setInfo(result);
      setState("waiting");
      pollTimer = setTimeout(poll, result.interval * 1000);
    });

    return () => {
      cancelled = true;
      if (pollTimer) clearTimeout(pollTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const qrTarget = info?.verification_url_complete ?? info?.verification_url;
  const qrDataUrl = useMemo(() => (qrTarget ? qrCodeDataUrl(qrTarget) : undefined), [qrTarget]);

  return (
    <ModalRoot onCancel={onClose} closeModal={onClose} bHideCloseIcon={false}>
      <div
        style={{
          minHeight: PIP_CONTENT_HEIGHT,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: "8px" }}>Link Google Drive</div>

        {state === "starting" && <div>Starting...</div>}

        {state === "waiting" && info && (
          <>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "24px" }}>
              {qrDataUrl && <img src={qrDataUrl} alt="QR code" style={{ width: "180px", height: "180px" }} />}
              <div>
                <div style={{ fontSize: "0.8em", opacity: 0.7 }}>Code</div>
                <div style={{ fontSize: "2.6em", fontWeight: 700, letterSpacing: "0.08em", fontFamily: "monospace" }}>
                  {info.user_code}
                </div>
              </div>
            </div>
            <div style={{ fontSize: "0.75em", opacity: 0.7, margin: "8px 0 4px" }}>
              Scan with your phone, then approve access.
            </div>
            <div style={{ fontSize: "0.7em", opacity: 0.6 }}>Waiting for approval...</div>
          </>
        )}

        {state === "success" && <div style={{ color: "#4caf50" }}>✓ Linked! You can close this window.</div>}
        {state === "expired" && <div>The code expired before it was approved. Try again from Share options.</div>}
        {state === "error" && (
          <div>
            {startError === "not_configured"
              ? "Google Drive isn't set up yet. Use \"Set up Google Drive\" in Share options first."
              : "Couldn't link Google Drive. Check that the client ID is right and the plugin log."}
          </div>
        )}
      </div>
    </ModalRoot>
  );
}

function openGoogleDriveLinkModal(onLinked: () => void) {
  const modal = showModal(<GoogleDriveLinkModal onLinked={onLinked} onClose={() => modal.Close()} />);
}

// Step-up confirmation shown before starting the link flow: linking saves a
// (locally obfuscated, not truly encrypted -- see main.py) session on disk
// so you don't have to re-approve on every use. Requiring the Deck's own
// password here means someone who picks up an already-unlocked Deck can't
// silently link their own Google account on it. The password is sent once,
// straight to sudo's stdin on the backend, and is never logged or stored.
const NATIVE_PASSWORD_PROPS = { type: "password" };

// Each user enters the client id/secret of THEIR OWN Google / Discord app, so
// the plugin ships no secret. Typing these with the on-screen keyboard is
// tedious, so the modal points to the README's step-by-step guide and the
// values are only ever needed once (they're saved on this Deck, obfuscated).
const CREDENTIAL_ERRORS: Record<"google" | "discord", Record<string, string>> = {
  google: {
    invalid_id: "That doesn't look like a Google client ID. It ends in .apps.googleusercontent.com.",
    invalid_secret: "The client secret looks too short or has spaces in it.",
    linked: "Unlink Google Drive first; the saved session belongs to the current client.",
    disabled: "Google Drive is turned off in this build.",
  },
  discord: {
    invalid_id: "The Discord application ID is a long number (about 19 digits).",
    invalid_secret: "The client secret looks too short or has spaces in it.",
    linked: "",
    disabled: "Discord is turned off in this build.",
  },
};

function CredentialsSetupModal({
  kind,
  onSaved,
  onClose,
}: {
  kind: "google" | "discord";
  onSaved: () => void;
  onClose: () => void;
}) {
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const isGoogle = kind === "google";

  const save = async () => {
    if (!clientId.trim() || !clientSecret.trim() || saving) return;
    setSaving(true);
    setError(undefined);
    try {
      const result = await (isGoogle ? setGoogleCredentials : setDiscordCredentials)(clientId, clientSecret);
      if (result.ok) {
        toaster.toast({ title: `${isGoogle ? "Google Drive" : "Discord"} is set up`, body: "Now link it from Share options." });
        onSaved();
        onClose();
      } else {
        setError(CREDENTIAL_ERRORS[kind][result.error ?? ""] || "Couldn't save those values.");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalRoot onCancel={onClose} closeModal={onClose} bHideCloseIcon={false}>
      <div style={{ minHeight: PIP_CONTENT_HEIGHT, display: "flex", flexDirection: "column", justifyContent: "center" }}>
        <div style={{ fontWeight: 600, marginBottom: "6px" }}>Set up {isGoogle ? "Google Drive" : "Discord"}</div>
        <div style={{ fontSize: "0.72em", opacity: 0.8, marginBottom: "8px" }}>
          {isGoogle
            ? "Create your own Google app (a \"TVs and Limited Input devices\" OAuth client) and paste its client ID and secret. The README's \"Setting up Google Drive\" section lists every step."
            : "Create your own Discord application, add the redirect http://localhost:47821/callback, and paste its application ID and client secret. The README's \"Setting up Discord\" section lists every step."}{" "}
          They're kept on this Deck only.
        </div>
        <TextField
          label={isGoogle ? "Client ID" : "Application (client) ID"}
          bShowClearAction
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
        />
        <TextField
          label="Client secret"
          bIsPassword
          {...NATIVE_PASSWORD_PROPS}
          value={clientSecret}
          onChange={(e) => setClientSecret(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
          }}
        />
        {error && <div style={{ color: "#f44336", fontSize: "0.75em", marginTop: "6px" }}>{error}</div>}
        <div style={{ marginTop: "8px" }}>
          <ButtonItem layout="below" disabled={!clientId.trim() || !clientSecret.trim() || saving} onClick={save}>
            {saving ? "Saving..." : "Save"}
          </ButtonItem>
        </div>
      </div>
    </ModalRoot>
  );
}

function openCredentialsSetup(kind: "google" | "discord", onSaved: () => void) {
  const modal = showModal(<CredentialsSetupModal kind={kind} onSaved={onSaved} onClose={() => modal.Close()} />);
}

function LinkConfirmModal({
  service,
  detail,
  onConfirmed,
  onClose,
}: {
  service: string;
  detail: string;
  onConfirmed: () => void;
  onClose: () => void;
}) {
  const [password, setPassword] = useState("");
  const [checking, setChecking] = useState(false);
  const [errorShown, setErrorShown] = useState(false);

  const onContinue = async () => {
    if (!password) return;
    setChecking(true);
    setErrorShown(false);
    try {
      const ok = await verifySudoPassword(password);
      if (ok) {
        onConfirmed();
      } else {
        setErrorShown(true);
      }
    } finally {
      setPassword("");
      setChecking(false);
    }
  };

  return (
    <ModalRoot onCancel={onClose} closeModal={onClose} bHideCloseIcon={false}>
      <div style={{ minHeight: PIP_CONTENT_HEIGHT, display: "flex", flexDirection: "column", justifyContent: "center" }}>
        <div style={{ fontWeight: 600, marginBottom: "8px" }}>Link {service}</div>
        <div style={{ fontSize: "0.75em", opacity: 0.8, marginBottom: "10px" }}>
          {detail} It's obfuscated on disk, not left as plain text, but it isn't full encryption — if
          this Deck were ever compromised, it could be at risk. Enter this Deck's password to
          confirm it's really you before continuing.
        </div>
        {/* `bIsPassword` alone didn't mask the input in practice, so the native
            HTML `type="password"` is forced through too -- TextFieldProps'
            declared type doesn't include `type` (it extends the generic
            HTMLAttributes, not InputHTMLAttributes), but the underlying
            element is a real <input>, so this still reaches it. It's passed
            as a spread (NATIVE_PASSWORD_PROPS) because TypeScript doesn't
            excess-property-check spread attributes, which avoids a TS2322
            error for a prop that isn't in the declared type. */}
        <TextField
          bIsPassword
          {...NATIVE_PASSWORD_PROPS}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onContinue();
          }}
          focusOnMount
        />
        {errorShown && (
          <div style={{ color: "#f44336", fontSize: "0.75em", marginTop: "6px" }}>
            Incorrect password. Try again.
          </div>
        )}
        <div style={{ marginTop: "10px" }}>
          <ButtonItem layout="below" disabled={!password || checking} onClick={onContinue}>
            {checking ? "Checking..." : "Continue"}
          </ButtonItem>
        </div>
      </div>
    </ModalRoot>
  );
}

function openGoogleDriveConfirmModal(onLinked: () => void) {
  const modal = showModal(
    <LinkConfirmModal
      service="Google Drive"
      detail="Linking saves a session on this Deck so you won't have to re-approve every time."
      onConfirmed={() => {
        modal.Close();
        openGoogleDriveLinkModal(onLinked);
      }}
      onClose={() => modal.Close()}
    />
  );
}

// Discord has no device flow, so there's no phone QR here: the authorize
// page opens in the Deck's own Steam browser, and Discord redirects back to
// a listener the plugin backend runs on this same Deck (localhost). The
// backend finishes the link by itself; this modal just opens the page and
// watches for the result. (Discord's own login page offers "log in with QR
// code" from your phone if typing a password on the Deck is a hassle.)
function DiscordLinkModal({ onLinked, onClose }: { onLinked: () => void; onClose: () => void }) {
  const [state, setState] = useState<"starting" | "ready" | "success" | "denied" | "expired" | "error">("starting");
  const [authUrl, setAuthUrl] = useState<string | undefined>();
  const [errorText, setErrorText] = useState<string | undefined>();
  // Set once the browser has been opened: from then on the backend listener
  // must survive this modal closing, or Discord's redirect would hit nothing.
  const handedOffToBrowser = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      const result = await pollDiscordLink();
      if (cancelled) return;
      if (result.status === "pending" || result.status === "idle") {
        pollTimer = setTimeout(poll, 2000);
      } else if (result.status === "success") {
        setState("success");
        onLinked();
      } else {
        setState(result.status);
      }
    };

    startDiscordLink().then((result) => {
      if (cancelled) return;
      if (result.error || !result.auth_url) {
        setErrorText(
          result.error === "not_configured"
            ? "Discord isn't set up in this build (missing discord_credentials.json)."
            : result.error === "port_busy"
              ? "Port 47821 is busy. Close whatever is using it and try again."
              : "Couldn't start the Discord link. Check the plugin log."
        );
        setState("error");
        return;
      }
      setAuthUrl(result.auth_url);
      setState("ready");
      pollTimer = setTimeout(poll, 2000);
    });

    return () => {
      cancelled = true;
      if (pollTimer) clearTimeout(pollTimer);
      if (!handedOffToBrowser.current) cancelDiscordLink();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <ModalRoot onCancel={onClose} closeModal={onClose} bHideCloseIcon={false}>
      <div
        style={{
          minHeight: PIP_CONTENT_HEIGHT,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: "8px" }}>Link Discord</div>

        {state === "starting" && <div>Starting...</div>}

        {state === "ready" && authUrl && (
          <>
            <div style={{ fontSize: "0.75em", opacity: 0.8, marginBottom: "8px" }}>
              Log in to Discord and pick the channel screenshots should be posted to. Uploads go
              to that channel only, and Discord can't be used to send private messages this way
              (a private server of your own works as a "DM to myself").
            </div>
            <ButtonItem
              layout="below"
              onClick={() => {
                handedOffToBrowser.current = true;
                Navigation.NavigateToExternalWeb(authUrl);
                onClose();
              }}
            >
              Open Discord login
            </ButtonItem>
            <div style={{ fontSize: "0.7em", opacity: 0.6 }}>
              Opens in the Steam browser. When it says "Discord linked", come back here.
            </div>
          </>
        )}

        {state === "success" && <div style={{ color: "#4caf50" }}>✓ Linked! You can close this window.</div>}
        {state === "denied" && <div>Authorization was cancelled. Try again from Share options.</div>}
        {state === "expired" && <div>The link request timed out. Try again from Share options.</div>}
        {state === "error" && <div>{errorText ?? "Couldn't link Discord. Check the plugin log."}</div>}
      </div>
    </ModalRoot>
  );
}

function openDiscordConfirmModal(onLinked: () => void) {
  const modal = showModal(
    <LinkConfirmModal
      service="Discord"
      detail="Linking saves a webhook address on this Deck; anyone who has it can post to that Discord channel."
      onConfirmed={() => {
        modal.Close();
        const linkModal = showModal(<DiscordLinkModal onLinked={onLinked} onClose={() => linkModal.Close()} />);
      }}
      onClose={() => modal.Close()}
    />
  );
}

const FRIEND_PICKER_MAX_SHOWN = 8;

// Steam accounts can have hundreds of friends, so instead of a huge
// dropdown this filters by name and shows only the first few matches.
function FriendPickerModal({ onPick, onClose }: { onPick: (friend: SteamFriend) => void; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const friends = useMemo(() => listSteamFriends(), []);
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? friends.filter((f) => f.name.toLowerCase().includes(q)) : friends;
  }, [friends, query]);

  return (
    <ModalRoot onCancel={onClose} closeModal={onClose} bHideCloseIcon={false}>
      <div style={{ minHeight: PIP_CONTENT_HEIGHT, display: "flex", flexDirection: "column" }}>
        <div style={{ fontWeight: 600, marginBottom: "4px" }}>Send to a Steam friend</div>
        <div style={{ fontSize: "0.75em", opacity: 0.8, marginBottom: "8px" }}>
          Opens the chat with this screenshot ready to send. You can tag it as a spoiler there
          before sending.
        </div>
        <TextField value={query} onChange={(e) => setQuery(e.target.value)} />
        {friends.length === 0 && (
          <div style={{ marginTop: "8px" }}>No friends found. Steam's friends list may not be loaded yet.</div>
        )}
        {matches.slice(0, FRIEND_PICKER_MAX_SHOWN).map((friend) => (
          <ButtonItem key={friend.accountid} layout="below" onClick={() => onPick(friend)}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              {friend.avatarUrl && (
                <img src={friend.avatarUrl} alt="" style={{ width: 28, height: 28, borderRadius: 4 }} />
              )}
              <span>{friend.name}</span>
            </div>
          </ButtonItem>
        ))}
        {matches.length > FRIEND_PICKER_MAX_SHOWN && (
          <div style={{ fontSize: "0.7em", opacity: 0.6, marginTop: "4px" }}>
            Showing {FRIEND_PICKER_MAX_SHOWN} of {matches.length}. Type to narrow it down.
          </div>
        )}
      </div>
    </ModalRoot>
  );
}

function openSteamFriendPicker(item: ScreenshotItem) {
  const modal = showModal(
    <FriendPickerModal
      onPick={(friend) => {
        modal.Close();
        // If the user backs out of the chat with B, come back to this picker.
        shareToSteamFriend(item, friend, () => openSteamFriendPicker(item));
      }}
      onClose={() => modal.Close()}
    />
  );
}

// Important: OK and Cancel (the controller's B button always fires Cancel)
// only close the preview, with no destructive actions — "Delete" used to
// live in the Cancel slot and B would delete the screenshot by accident.
// Share and Delete are now plain buttons inside the content, never tied to
// OK/Cancel.
function PreviewModalContent({
  item,
  onDeleted,
  onClose,
}: {
  item: ScreenshotItem;
  onDeleted: () => void;
  onClose: () => void;
}) {
  const [src, setSrc] = useState<string>(item.thumbnail);
  const [shareMethod, setShareMethod] = useState("qr");

  useEffect(() => {
    let cancelled = false;
    getScreenshotImage(item.path).then((fullImage) => {
      if (!cancelled && fullImage) setSrc(fullImage);
    });
    return () => {
      cancelled = true;
    };
  }, [item.path]);

  const onDelete = async () => {
    const ok = await deleteScreenshot(item.path);
    if (ok) {
      toaster.toast({ title: "Screenshot deleted", body: item.filename });
      onDeleted();
      onClose();
    } else {
      toaster.toast({ title: "Couldn't delete the screenshot", body: item.filename });
    }
  };

  const onShareMethodChange = async (option: { data: string; label: string }) => {
    setShareMethod(option.data);
    if (option.data === "qr") {
      onClose();
      openShareModal(item, onDeleted);
      return;
    }
    if (option.data === "googledrive") {
      const status = await getGoogleDriveStatus();
      if (!status.linked) {
        toaster.toast({ title: "Google Drive isn't linked", body: "Link it from Share options first." });
        return;
      }
      toaster.toast({ title: "Uploading to Google Drive...", body: item.filename });
      const result = await uploadScreenshotToDrive(item.path);
      if (result.ok) {
        toaster.toast({ title: "Uploaded to Google Drive", body: item.filename });
      } else if (result.error === "duplicate") {
        toaster.toast({ title: "Already on Google Drive", body: `${item.filename} was uploaded before.` });
      } else {
        toaster.toast({ title: "Upload failed", body: "Check the plugin log for details." });
      }
      return;
    }
    if (option.data === "steam") {
      const config = await getSteamAutoUploadConfig();
      await shareToSteamAccount(item, config.steam_upload_privacy);
      return;
    }
    if (option.data === "steamfriend") {
      openSteamFriendPicker(item);
      return;
    }
    if (option.data === "discord") {
      const status = await getDiscordStatus();
      if (!status.linked) {
        toaster.toast({ title: "Discord isn't linked", body: "Link it from Share options first." });
        return;
      }
      toaster.toast({ title: "Sending to Discord...", body: item.filename });
      const result = await uploadScreenshotToDiscord(item.path);
      if (result.ok) {
        toaster.toast({ title: "Sent to Discord", body: item.filename });
      } else if (result.error === "not_linked") {
        toaster.toast({ title: "Discord link is gone", body: "The webhook was removed on Discord. Link it again." });
      } else if (result.error === "too_large") {
        toaster.toast({ title: "Too large for Discord", body: "That server's upload limit was exceeded." });
      } else if (result.error === "rate_limited") {
        toaster.toast({ title: "Discord is rate limiting", body: "Wait a few seconds and try again." });
      } else {
        toaster.toast({ title: "Upload failed", body: "Check the plugin log for details." });
      }
      return;
    }
  };

  return (
    <ModalRoot onCancel={onClose} closeModal={onClose} bHideCloseIcon={false}>
      <div style={{ minHeight: PIP_CONTENT_HEIGHT, display: "flex", flexDirection: "column", justifyContent: "center" }}>
        <div style={{ fontWeight: 600 }}>{item.filename}</div>
        <div style={{ fontSize: "0.8em", opacity: 0.7, marginBottom: "8px" }}>{item.appName}</div>
        <img
          src={src}
          alt={item.filename}
          style={{ maxWidth: "90%", maxHeight: PIP_CONTENT_HEIGHT, borderRadius: 4, display: "block", margin: "0 auto" }}
        />
        <div style={{ marginTop: "8px" }}>
          <DropdownItem
            label="Share"
            rgOptions={SHARE_METHOD_OPTIONS}
            selectedOption={shareMethod}
            onChange={onShareMethodChange}
          />
        </div>
        <div style={{ marginTop: "8px" }}>
          <ButtonItem layout="below" onClick={onDelete}>
            Delete
          </ButtonItem>
        </div>
      </div>
    </ModalRoot>
  );
}

function openPreview(item: ScreenshotItem, onDeleted: () => void) {
  const modal = showModal(
    <PreviewModalContent item={item} onDeleted={onDeleted} onClose={() => modal.Close()} />
  );
}

function GalleryRow({ item, onOpen }: { item: ScreenshotItem; onOpen: () => void }) {
  const [highlighted, setHighlighted] = useState(false);

  return (
    <Focusable
      style={{
        display: "flex",
        alignItems: "center",
        gap: "8px",
        cursor: "pointer",
        padding: "4px",
        borderRadius: "4px",
        backgroundColor: highlighted ? "rgba(255, 255, 255, 0.15)" : "transparent",
      }}
      onActivate={onOpen}
      onFocus={() => setHighlighted(true)}
      onBlur={() => setHighlighted(false)}
      onMouseEnter={() => setHighlighted(true)}
      onMouseLeave={() => setHighlighted(false)}
    >
      <img
        src={item.thumbnail}
        alt={item.filename}
        style={{
          width: "96px",
          height: "60px",
          objectFit: "cover",
          borderRadius: "4px",
          flexShrink: 0,
        }}
      />
      <div style={{ overflow: "hidden" }}>
        <div
          style={{
            fontSize: "0.8em",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {item.filename}
        </div>
        <div style={{ fontSize: "0.75em", opacity: 0.6 }}>{item.appName}</div>
      </div>
    </Focusable>
  );
}

function Gallery() {
  const [expanded, setExpanded] = useState(false);
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<ScreenshotPage | undefined>();
  const [loading, setLoading] = useState(false);

  // Fetches only the requested batch (5 images) instead of reloading the whole plugin.
  const loadPage = useCallback(async (requestedOffset: number) => {
    setLoading(true);
    try {
      const result = await getScreenshots(Math.max(0, requestedOffset), PAGE_SIZE);
      setPage(result);
      setOffset(result.offset);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPage(0);
  }, [loadPage]);

  // If auto-delete ran (limit exceeded), the current page is no longer
  // valid — go back to the start to reflect the real state.
  useEffect(() => {
    const listener = addEventListener<[count: number]>("auto_delete_performed", () => {
      loadPage(0);
    });
    return () => removeEventListener("auto_delete_performed", listener);
  }, [loadPage]);

  const total = page?.total ?? 0;
  const hasPrev = offset > 0;
  const hasNext = offset + PAGE_SIZE < total;
  const refreshCurrentPage = () => loadPage(offset);

  return (
    <PanelSection title="Gallery">
      <PanelSectionRow>
        <ButtonItem layout="below" onClick={() => setExpanded((e) => !e)}>
          {total ? `Gallery (${total})` : "Gallery"} {expanded ? "▲" : "▼"}
        </ButtonItem>
      </PanelSectionRow>

      {expanded && (
        <>
          {loading && (
            <PanelSectionRow>
              <div>Loading...</div>
            </PanelSectionRow>
          )}

          {!loading && page?.items.length === 0 && (
            <PanelSectionRow>
              <div>
                No Steam screenshots yet. Take one with the Steam button + R1
                (or RB) and refresh here.
              </div>
            </PanelSectionRow>
          )}

          {page?.items.map((item) => (
            <PanelSectionRow key={item.path}>
              <GalleryRow item={item} onOpen={() => openPreview(item, refreshCurrentPage)} />
            </PanelSectionRow>
          ))}

          <PanelSectionRow>
            <Focusable style={{ display: "flex", gap: "8px" }}>
              <Button
                style={{ width: "64px", display: "flex", justifyContent: "center", flexShrink: 0 }}
                disabled={!hasPrev || loading}
                onClick={() => loadPage(offset - PAGE_SIZE)}
              >
                <FaArrowUp />
              </Button>
              <Button
                style={{ width: "64px", display: "flex", justifyContent: "center", flexShrink: 0 }}
                disabled={!hasNext || loading}
                onClick={() => loadPage(offset + PAGE_SIZE)}
              >
                <FaArrowDown />
              </Button>
            </Focusable>
          </PanelSectionRow>
          <PanelSectionRow>
            <ButtonItem layout="below" disabled={loading} onClick={() => loadPage(0)}>
              <FaSyncAlt /> Refresh
            </ButtonItem>
          </PanelSectionRow>
        </>
      )}
    </PanelSection>
  );
}

const SETTINGS_SAVE_DELAY_MS = 400;

// The UI updates instantly, but the backend is only told once the user pauses.
// Saving on every step of a slider drag made the backend run a full settings
// save (plus its storage checks) for each tick of the drag.
function useSettingsUpdater(settings: Settings | undefined, setLocalSettings: (settings: Settings) => void) {
  const latest = useRef<Settings | undefined>(settings);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // While a save is pending, `latest` holds the newest local edit; don't let a re-render overwrite it.
  if (!timer.current) latest.current = settings;

  return useCallback(
    (patch: Partial<Settings>) => {
      if (!latest.current) return;
      const next = { ...latest.current, ...patch };
      latest.current = next;
      setLocalSettings(next);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(async () => {
        timer.current = undefined;
        const saved = await setSettings(next);
        // Adopt the backend's answer only if nothing was changed while saving.
        if (!timer.current) {
          latest.current = saved;
          setLocalSettings(saved);
        }
      }, SETTINGS_SAVE_DELAY_MS);
    },
    [setLocalSettings]
  );
}

function StoragePanel() {
  const [expanded, setExpanded] = useState(false);
  const [settings, setLocalSettings] = useState<Settings | undefined>();

  const refresh = useCallback(() => {
    getSettings().then(setLocalSettings);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const listener = addEventListener<[count: number]>("auto_delete_performed", (count) => {
      toaster.toast({
        title: "Auto-delete ran",
        body: `${count} old screenshot(s) removed to stay under your limit.`,
      });
      refresh();
    });
    return () => removeEventListener("auto_delete_performed", listener);
  }, [refresh]);

  // Fired by the backend (checked whenever the gallery loads/refreshes,
  // the closest proxy we have to "right after a new screenshot was taken",
  // since Steam -- not us -- does the actual capturing) the first time
  // usage crosses 80/90/100%. `critical: true` is the only "make this red
  // and urgent" knob the toast API exposes; there's no free-form color.
  useEffect(() => {
    const listener = addEventListener<[threshold: number]>("storage_threshold_reached", (threshold) => {
      if (threshold >= 100) {
        toaster.toast({ title: "Storage limit reached", body: "You're at or over your configured limit.", critical: true });
      } else if (threshold >= 90) {
        toaster.toast({ title: "Storage critical (90%)", body: "You're almost at your limit.", critical: true });
      } else {
        toaster.toast({ title: "Storage warning (80%)", body: "Your screenshots are taking up a lot of space." });
      }
      refresh();
    });
    return () => removeEventListener("storage_threshold_reached", listener);
  }, [refresh]);

  const update = useSettingsUpdater(settings, setLocalSettings);

  const isUnlimited = settings?.max_storage_mb === STORAGE_LIMIT_UNLIMITED;
  const usedPct = settings && !isUnlimited && settings.max_storage_mb > 0 ? (settings.used_mb / settings.max_storage_mb) * 100 : 0;
  const tierColor = usedPct >= 100 ? "#f44336" : usedPct >= 90 ? "#ff7043" : usedPct >= 80 ? "#f5a623" : undefined;
  const tierMessage =
    usedPct >= 100
      ? 'Limit exceeded. Delete screenshots from the gallery (tap one and choose "Delete") or raise the limit above.'
      : usedPct >= 90
      ? "Storage is critically full (90%+ used). Consider deleting some screenshots soon."
      : usedPct >= 80
      ? "Storage warning: 80% or more of your limit is used."
      : undefined;
  const summary = settings
    ? `Storage: ${settings.used_mb} MB / ${storageLimitShort(settings.max_storage_mb / 1024)}`
    : "Storage: loading...";

  const onLimitChange = (index: number) => {
    const gb = STORAGE_LIMIT_VALUES_GB[index];
    const mb = gb === STORAGE_LIMIT_UNLIMITED ? 0 : Math.round(gb * 1024);
    update(mb === 0 ? { max_storage_mb: 0, auto_delete: false } : { max_storage_mb: mb });
  };

  return (
    <PanelSection title="Storage">
      <PanelSectionRow>
        <ButtonItem layout="below" disabled={!settings} onClick={() => setExpanded((e) => !e)}>
          {summary} {expanded ? "▲" : "▼"}
        </ButtonItem>
      </PanelSectionRow>

      {expanded && settings && (
        <>
          {!settings.account_detected && (
            <PanelSectionRow>
              <div style={{ color: "#f5a623" }}>
                Couldn't detect your Steam account in userdata/. The gallery might show up empty.
              </div>
            </PanelSectionRow>
          )}

          <PanelSectionRow>
            <div style={{ fontSize: "1.1em", fontWeight: 700, marginBottom: "4px" }}>
              {storageLimitDescription(settings.max_storage_mb / 1024)}
            </div>
            {isUnlimited && (
              <div style={{ fontSize: "0.65em", opacity: 0.6, marginBottom: "6px" }}>
                Not recommended on Decks with a small SSD.
              </div>
            )}
            <SliderField
              label="Warning Limit"
              description="Gives a warning when your screenshots pass this size."
              value={storageLimitIndexForMb(settings.max_storage_mb)}
              min={0}
              max={STORAGE_LIMIT_LAST_INDEX}
              step={1}
              onChange={onLimitChange}
            />
          </PanelSectionRow>

          {tierColor && tierMessage && (
            <PanelSectionRow>
              <div style={{ color: tierColor, fontWeight: usedPct >= 90 ? 600 : undefined }}>{tierMessage}</div>
            </PanelSectionRow>
          )}

          <PanelSectionRow>
            <ToggleField
              label="Auto-delete oldest when over limit"
              description={
                isUnlimited
                  ? "Not applicable with no limit set."
                  : "⚠ WARNING: if enabled, once you pass the Warning Limit above, this plugin will PERMANENTLY DELETE your oldest screenshots — from ANY game — without asking, until you're back under the limit. This cannot be undone. Leave this off unless you're sure."
              }
              checked={settings.auto_delete}
              disabled={isUnlimited}
              onChange={(checked) => update({ auto_delete: checked })}
            />
          </PanelSectionRow>
        </>
      )}
    </PanelSection>
  );
}

// Bounds of the auto-upload delay slider; main.py enforces the same range.
const AUTO_UPLOAD_DELAY_MIN = 5;
const AUTO_UPLOAD_DELAY_MAX = 60;

// The auto-upload toggle plus, once it's on, the slider for how long to wait
// after a screenshot before uploading. The chosen value is shown in the
// label itself (like the storage limit) rather than relying on the
// slider's own value display.
function AutoUploadOptions({
  label,
  description,
  enabled,
  delaySeconds,
  onEnabledChange,
  onDelayChange,
}: {
  label: string;
  description: string;
  enabled: boolean;
  delaySeconds: number;
  onEnabledChange: (value: boolean) => void;
  onDelayChange: (seconds: number) => void;
}) {
  return (
    <>
      <PanelSectionRow>
        <ToggleField label={label} description={description} checked={enabled} onChange={onEnabledChange} />
      </PanelSectionRow>
      {enabled && (
        <PanelSectionRow>
          <SliderField
            label={`Upload delay: ${delaySeconds} s`}
            description="How long to wait after a screenshot before it's uploaded. Delete it or switch this off in that time to cancel."
            value={delaySeconds}
            min={AUTO_UPLOAD_DELAY_MIN}
            max={AUTO_UPLOAD_DELAY_MAX}
            step={1}
            onChange={onDelayChange}
          />
        </PanelSectionRow>
      )}
    </>
  );
}

function ShareOptionsPanel() {
  const [expanded, setExpanded] = useState(false);
  const [driveOpen, setDriveOpen] = useState(false);
  const [discordOpen, setDiscordOpen] = useState(false);
  const [steamOpen, setSteamOpen] = useState(false);
  const [settings, setLocalSettings] = useState<Settings | undefined>();
  const [driveLinked, setDriveLinked] = useState<boolean | undefined>();
  const [driveConfigured, setDriveConfigured] = useState<boolean | undefined>();
  const [driveCredentialsSource, setDriveCredentialsSource] = useState<string | null | undefined>();
  const [unlinking, setUnlinking] = useState(false);
  const [discordLinked, setDiscordLinked] = useState<boolean | undefined>();
  const [discordConfigured, setDiscordConfigured] = useState<boolean | undefined>();
  const [discordCredentialsSource, setDiscordCredentialsSource] = useState<string | null | undefined>();
  const [unlinkingDiscord, setUnlinkingDiscord] = useState(false);

  const refreshDriveStatus = useCallback(() => {
    if (!GOOGLE_DRIVE_ENABLED) return;
    getGoogleDriveStatus().then((s) => {
      setDriveLinked(s.linked);
      setDriveConfigured(s.configured);
      setDriveCredentialsSource(s.credentials_source);
    });
  }, []);

  const refreshDiscordStatus = useCallback(() => {
    if (!DISCORD_ENABLED) return;
    getDiscordStatus().then((s) => {
      setDiscordLinked(s.linked);
      setDiscordConfigured(s.configured);
      setDiscordCredentialsSource(s.credentials_source);
    });
  }, []);

  useEffect(() => {
    getSettings().then(setLocalSettings);
    refreshDriveStatus();
    refreshDiscordStatus();
  }, [refreshDriveStatus, refreshDiscordStatus]);

  const update = useSettingsUpdater(settings, setLocalSettings);

  const onResetGoogleCredentials = async () => {
    const result = await clearGoogleCredentials();
    toaster.toast(
      result.ok
        ? { title: "Google credentials removed", body: "Set up Google Drive again to link." }
        : { title: "Couldn't remove them", body: "Unlink Google Drive first." }
    );
    refreshDriveStatus();
  };

  const onResetDiscordCredentials = async () => {
    await clearDiscordCredentials();
    toaster.toast({ title: "Discord credentials removed", body: "Set up Discord again to link." });
    refreshDiscordStatus();
  };

  const onUnlinkDrive = async () => {
    setUnlinking(true);
    try {
      await unlinkGoogleDrive();
      toaster.toast({ title: "Google Drive unlinked", body: "Access has been revoked." });
      refreshDriveStatus();
      getSettings().then(setLocalSettings); // the backend switches its auto-upload off

    } finally {
      setUnlinking(false);
    }
  };

  const onUnlinkDiscord = async () => {
    setUnlinkingDiscord(true);
    try {
      await unlinkDiscord();
      toaster.toast({ title: "Discord unlinked", body: "The webhook was deleted." });
      refreshDiscordStatus();
      getSettings().then(setLocalSettings); // the backend switches its auto-upload off
    } finally {
      setUnlinkingDiscord(false);
    }
  };

  return (
    <PanelSection title="Share options">
      <PanelSectionRow>
        <ButtonItem layout="below" disabled={!settings} onClick={() => setExpanded((e) => !e)}>
          Share options {expanded ? "▲" : "▼"}
        </ButtonItem>
      </PanelSectionRow>

      {expanded && settings && (
        <>
          <PanelSectionRow>
            <div style={{ fontWeight: 600 }}>QR Link</div>
          </PanelSectionRow>
          <PanelSectionRow>
            <DropdownItem
              label="QR link stays active for"
              description="How long a 'Share via QR' link stays valid if nobody downloads it."
              rgOptions={DURATION_OPTIONS}
              selectedOption={settings.qr_share_duration_seconds}
              onChange={(option) => update({ qr_share_duration_seconds: option.data })}
            />
          </PanelSectionRow>
        </>
      )}

      {expanded && STEAM_SHARE_AVAILABLE && (
        <>
          <PanelSectionRow>
            <ButtonItem layout="below" onClick={() => setSteamOpen((o) => !o)}>
              Steam {steamOpen ? "▲" : "▼"}
            </ButtonItem>
          </PanelSectionRow>

          {steamOpen && settings && (
            <>
              <PanelSectionRow>
                <DropdownItem
                  label="Upload privacy"
                  description="Who can see screenshots uploaded to your Steam account, manually or automatically. Sending to a friend always uses Friends only."
                  rgOptions={STEAM_PRIVACY_OPTIONS}
                  selectedOption={settings.steam_upload_privacy}
                  onChange={(option) => update({ steam_upload_privacy: option.data })}
                />
              </PanelSectionRow>
              <AutoUploadOptions
                label="Auto-upload to Steam"
                description="Uploads each new screenshot to your Steam account without asking, with the privacy above. It counts against your Steam Cloud space."
                enabled={settings.auto_upload_steam}
                delaySeconds={settings.auto_upload_delay_steam}
                onEnabledChange={(value) => update({ auto_upload_steam: value })}
                onDelayChange={(seconds) => update({ auto_upload_delay_steam: seconds })}
              />
              {settings.auto_upload_steam && settings.steam_upload_privacy === 8 && (
                <PanelSectionRow>
                  <div style={{ color: "#f5a623", fontSize: "0.75em" }}>
                    Privacy is Public: every auto-uploaded screenshot will be visible to everyone on your profile.
                  </div>
                </PanelSectionRow>
              )}
            </>
          )}
        </>
      )}

      {expanded && GOOGLE_DRIVE_ENABLED && (
        <>
          <PanelSectionRow>
            <ButtonItem layout="below" onClick={() => setDriveOpen((o) => !o)}>
              Google Drive{driveLinked ? " (linked)" : driveConfigured === false ? " (set up needed)" : ""} {driveOpen ? "▲" : "▼"}
            </ButtonItem>
          </PanelSectionRow>

          {driveOpen && driveConfigured === false && (
            <>
              <PanelSectionRow>
                <ButtonItem layout="below" onClick={() => openCredentialsSetup("google", refreshDriveStatus)}>
                  Set up Google Drive
                </ButtonItem>
              </PanelSectionRow>
              <PanelSectionRow>
                <div style={{ fontSize: "0.72em", opacity: 0.7 }}>
                  Uses your own Google app, so nothing is shared with anyone else. The README's "Setting up Google Drive" section explains how to create it.
                </div>
              </PanelSectionRow>
            </>
          )}

          {driveOpen && driveConfigured !== false && (
            <PanelSectionRow>
              {driveLinked ? (
                <ButtonItem layout="below" disabled={unlinking} onClick={onUnlinkDrive}>
                  {unlinking ? "Unlinking..." : "Unlink Google Drive"}
                </ButtonItem>
              ) : (
                <ButtonItem
                  layout="below"
                  disabled={driveLinked === undefined}
                  onClick={() => openGoogleDriveConfirmModal(refreshDriveStatus)}
                >
                  Link Google Drive
                </ButtonItem>
              )}
            </PanelSectionRow>
          )}

          {driveOpen && driveConfigured && !driveLinked && driveCredentialsSource === "user" && (
            <PanelSectionRow>
              <ButtonItem layout="below" onClick={onResetGoogleCredentials}>
                Reset my Google credentials
              </ButtonItem>
            </PanelSectionRow>
          )}

          {driveOpen && driveLinked && settings && (
            <AutoUploadOptions
              label="Auto-upload to Google Drive"
              description="Uploads each new screenshot without asking. Anything in your screenshots gets uploaded, so leave this off if that's a concern."
              enabled={settings.auto_upload_google_drive}
              delaySeconds={settings.auto_upload_delay_google_drive}
              onEnabledChange={(value) => update({ auto_upload_google_drive: value })}
              onDelayChange={(seconds) => update({ auto_upload_delay_google_drive: seconds })}
            />
          )}
        </>
      )}

      {expanded && DISCORD_ENABLED && (
        <>
          <PanelSectionRow>
            <ButtonItem layout="below" onClick={() => setDiscordOpen((o) => !o)}>
              Discord{discordLinked ? " (linked)" : discordConfigured === false ? " (set up needed)" : ""} {discordOpen ? "▲" : "▼"}
            </ButtonItem>
          </PanelSectionRow>

          {discordOpen && discordConfigured === false && !discordLinked && (
            <>
              <PanelSectionRow>
                <ButtonItem layout="below" onClick={() => openCredentialsSetup("discord", refreshDiscordStatus)}>
                  Set up Discord
                </ButtonItem>
              </PanelSectionRow>
              <PanelSectionRow>
                <div style={{ fontSize: "0.72em", opacity: 0.7 }}>
                  Uses your own Discord application. The README's "Setting up Discord" section explains how to create it.
                </div>
              </PanelSectionRow>
            </>
          )}

          {discordOpen && (discordConfigured !== false || discordLinked) && (
            <PanelSectionRow>
              {discordLinked ? (
                <ButtonItem layout="below" disabled={unlinkingDiscord} onClick={onUnlinkDiscord}>
                  {unlinkingDiscord ? "Unlinking..." : "Unlink Discord"}
                </ButtonItem>
              ) : (
                <ButtonItem
                  layout="below"
                  disabled={discordLinked === undefined}
                  onClick={() => openDiscordConfirmModal(refreshDiscordStatus)}
                >
                  Link Discord
                </ButtonItem>
              )}
            </PanelSectionRow>
          )}

          {discordOpen && discordConfigured && !discordLinked && discordCredentialsSource === "user" && (
            <PanelSectionRow>
              <ButtonItem layout="below" onClick={onResetDiscordCredentials}>
                Reset my Discord credentials
              </ButtonItem>
            </PanelSectionRow>
          )}

          {discordOpen && discordLinked && settings && (
            <AutoUploadOptions
              label="Auto-upload to Discord"
              description="Posts each new screenshot to your linked channel without asking. Anyone in that channel will see it."
              enabled={settings.auto_upload_discord}
              delaySeconds={settings.auto_upload_delay_discord}
              onEnabledChange={(value) => update({ auto_upload_discord: value })}
              onDelayChange={(seconds) => update({ auto_upload_delay_discord: seconds })}
            />
          )}
        </>
      )}
    </PanelSection>
  );
}

function Content() {
  return (
    <>
      <Gallery />
      <StoragePanel />
      <ShareOptionsPanel />
    </>
  );
}

// Steam tells us about every new screenshot itself (no folder polling needed,
// unlike the backend uploaders). Handles already dealt with are remembered so
// a repeated notification can't upload twice.
const steamAutoUploadHandled = new Set<string>();

async function autoUploadNewSteamScreenshot(appId: number, handle: number): Promise<void> {
  const key = `${appId}:${handle}`;
  if (steamAutoUploadHandled.has(key)) return;
  steamAutoUploadHandled.add(key);
  try {
    const first = await getSteamAutoUploadConfig();
    if (!first.auto_upload_steam) return;
    await sleep(first.auto_upload_delay_steam * 1000);
    // The toggle is checked again after the wait, so switching it off in that window cancels the upload.
    const current = await getSteamAutoUploadConfig();
    if (!current.auto_upload_steam) return;
    const shot = (await listSteamScreenshots()).find((s) => s.nAppID === appId && s.hHandle === handle);
    if (!shot || shot.bUploaded) return; // deleted meanwhile, or already up
    const outcome = await uploadSteamScreenshot(shot, current.steam_upload_privacy);
    toaster.toast(
      outcome.ok
        ? { title: "Auto-uploaded to Steam", body: shot.strUrl.split("/").pop() ?? "" }
        : { title: "Auto-upload to Steam failed", body: "Steam didn't accept the upload." }
    );
  } catch (e) {
    console.error("Omni-Revi-Transfer: Steam auto-upload failed", e);
  }
}

export default definePlugin(() => {
  console.log("Omni-Revi-Transfer initializing")

  const steamScreenshotRegistration =
    STEAM_SHARE_AVAILABLE && typeof SteamClient.GameSessions?.RegisterForScreenshotNotification === "function"
      ? SteamClient.GameSessions.RegisterForScreenshotNotification((notification) => {
          autoUploadNewSteamScreenshot(notification.details.nAppID, notification.details.hHandle);
        })
      : undefined;

  // Registered here, not inside a component: auto-uploads happen in the
  // background while the quick access menu is closed, and the toast must
  // still show up then.
  const autoUploadListener = addEventListener<[service: string, filename: string, ok: boolean, error: string | null]>(
    "auto_upload_result",
    (service, filename, ok, error) => {
      if (ok) {
        toaster.toast({ title: `Auto-uploaded to ${service}`, body: filename });
      } else {
        const reason =
          error === "not_linked" ? "The link is no longer valid. Link it again from Share options."
          : error === "too_large" ? "The file is over the upload limit."
          : error === "rate_limited" ? "Rate limited; it won't be retried."
          : "Check the plugin log for details.";
        toaster.toast({ title: `Auto-upload to ${service} failed`, body: `${filename}: ${reason}` });
      }
    }
  );

  return {
    name: "Omni-Revi-Transfer",
    titleView: <div className={staticClasses.Title}>Omni-Revi-Transfer</div>,
    content: <Content />,
    icon: <FaCamera />,
    onDismount() {
      steamScreenshotRegistration?.unregister();
      removeEventListener("auto_upload_result", autoUploadListener);
    },
  };
});
