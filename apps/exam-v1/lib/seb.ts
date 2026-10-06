import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";

// ── Config Key validation ──────────────────────────────────────────────────
//
// SEB sends X-SafeExamBrowser-ConfigKeyHash = SHA256(pageUrl + configKey) in
// every HTTP request (classic WebView), or exposes SafeExamBrowser.security
// .configKey via JS API (modern WKWebView). Either way the value is the same.
//
// The Config Key itself = SHA256(sebJsonString) where sebJsonString is the
// plist settings converted to alphabetically-sorted compact JSON (SEB-JSON).
// Because we generate the config server-side we can compute it ourselves —
// no manual copy-paste, same value on all platforms and SEB versions.

// Never typed by anyone (allowQuit is off and SEB quits via quitURL), but part
// of the config and therefore of the Config Key.

/**
 * Verify an incoming SEB request. `requestUrl` must be the exact absolute URL
 * SEB requested (query included), because that is what SEB hashes.
 */
export function isSebConfigKeyRequest(requestUrl: string, configKeyHash: string | null, origin: string): boolean {
  if (!configKeyHash) return false;
  const url = requestUrl.split("#")[0];
  const expected = createHash("sha256").update(url + sebConfigKey(origin), "utf8").digest("hex");
  return expected === configKeyHash.toLowerCase();
}

/**
 * Whether a request comes from SEB at all: the Config Key header (SEB for Windows)
 * or the "SEB/<version>" every SEB adds to its user agent (SEB for macOS sends no
 * header). Only for choosing what to show; access is decided by the Config Key.
 */
export function fromSebBrowser(hdrs: Headers): boolean {
  return !!hdrs.get("x-safeexambrowser-configkeyhash") || /\bSEB\/\d/.test(hdrs.get("user-agent") ?? "");
}

/** The Config Key of the config served for this origin; the config is deterministic. */
export function sebConfigKey(origin: string): string {
  return computeConfigKey(sebPlist(origin));
}

/**
 * Compute the SEB Config Key from raw plist XML.
 * Algorithm: parse plist → recursively sort all dict keys → compact JSON
 * (no escaping, UTF-8) → SHA256 → hex.
 */
function computeConfigKey(plistXml: string): string {
  const obj = parsePlist(plistXml);
  const json = sebJson(obj);
  return createHash("sha256").update(json, "utf8").digest("hex");
}

// ── Plist → SEB-JSON ───────────────────────────────────────────────────────

type PlistValue = string | number | boolean | null | PlistValue[] | PlistDict;
type PlistDict = { [key: string]: PlistValue };

/** Minimal plist XML parser — handles the subset we generate. */
function parsePlist(xml: string): PlistDict {
  // Strip XML declaration, DOCTYPE, <plist> wrapper
  const body = xml
    .replace(/<\?xml[^>]*\?>/g, "")
    .replace(/<!DOCTYPE[^>]*>/g, "")
    .replace(/<plist[^>]*>/g, "")
    .replace(/<\/plist>/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .trim();
  const [value] = parseValue(body, 0);
  return value as PlistDict;
}

function skipWhitespace(s: string, i: number): number {
  while (i < s.length && /\s/.test(s[i])) i++;
  return i;
}

function parseValue(s: string, i: number): [PlistValue, number] {
  i = skipWhitespace(s, i);
  if (s.startsWith("<dict>", i)) return parseDict(s, i);
  if (s.startsWith("<array>", i)) return parseArray(s, i);
  if (s.startsWith("<string>", i)) return parseTagged(s, i, "string", (v) => v);
  if (s.startsWith("<integer>", i)) return parseTagged(s, i, "integer", (v) => parseInt(v, 10));
  if (s.startsWith("<real>", i)) return parseTagged(s, i, "real", (v) => parseFloat(v));
  if (s.startsWith("<true/>", i)) return [true, i + 7];
  if (s.startsWith("<false/>", i)) return [false, i + 8];
  if (s.startsWith("<data>", i)) return parseTagged(s, i, "data", (v) => ({ __data__: v.trim() }));
  if (s.startsWith("<date>", i)) return parseTagged(s, i, "date", (v) => v.trim());
  throw new Error(`parsePlist: unexpected token at ${i}: ${s.slice(i, i + 40)}`);
}

function parseTagged<T>(s: string, i: number, tag: string, fn: (v: string) => T): [T, number] {
  const open = `<${tag}>`;
  const close = `</${tag}>`;
  const end = s.indexOf(close, i + open.length);
  return [fn(s.slice(i + open.length, end)), end + close.length];
}

function parseDict(s: string, i: number): [PlistDict, number] {
  i += "<dict>".length;
  const obj: PlistDict = {};
  while (true) {
    i = skipWhitespace(s, i);
    if (s.startsWith("</dict>", i)) return [obj, i + 7];
    // Read <key>...</key>
    const keyEnd = s.indexOf("</key>", i + "<key>".length);
    const key = s.slice(i + "<key>".length, keyEnd);
    i = keyEnd + "</key>".length;
    const [val, next] = parseValue(s, i);
    obj[key] = val;
    i = next;
  }
}

function parseArray(s: string, i: number): [PlistValue[], number] {
  i += "<array>".length;
  const arr: PlistValue[] = [];
  while (true) {
    i = skipWhitespace(s, i);
    if (s.startsWith("</array>", i)) return [arr, i + 8];
    const [val, next] = parseValue(s, i);
    arr.push(val);
    i = next;
  }
}

// ── SEB-JSON serialiser ────────────────────────────────────────────────────
// Rules (from SEB spec):
//  - dicts: keys sorted case-insensitively, alphabetically
//  - no whitespace, no character escaping (backslashes stay as-is)
//  - <data> elements → base64 strings
//  - booleans → true/false, integers/reals → numbers
//  - empty dicts omitted

function sebJson(v: PlistValue): string {
  if (v === null) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") return `"${v}"`;
  if (Array.isArray(v)) return `[${v.map(sebJson).join(",")}]`;
  if (typeof v === "object" && "__data__" in v) {
    // <data> → base64 string
    return `"${(v as { __data__: string }).__data__}"`;
  }
  // dict — sort keys case-insensitively, skip empty dicts
  const dict = v as PlistDict;
  const keys = Object.keys(dict)
    .filter((k) => {
      const val = dict[k];
      return !(typeof val === "object" && val !== null && !Array.isArray(val) && Object.keys(val).length === 0);
    })
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  const pairs = keys.map((k) => `"${k}":${sebJson(dict[k])}`);
  return `{${pairs.join(",")}}`;
}

// ── .seb file ─────────────────────────────────────────────────────────────

/**
 * The .seb file for an exam served from `origin`: outer gzip of "plnd" + the
 * gzipped plist (SEB's unencrypted format, so students get no password prompt;
 * the download is already gated by a one-time token).
 */
export function buildSebConfig(origin: string): Buffer {
  const inner = Buffer.concat([Buffer.from("plnd"), gzipSync(Buffer.from(sebPlist(origin), "utf8"))]);
  return gzipSync(inner);
}

function sebPlist(origin: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>allowAirPlay</key>
	<false/>
	<key>allowBrowsingBackForward</key>
	<false/>
	<key>allowFind</key>
	<false/>
	<key>allowDictation</key>
	<false/>
	<key>allowDictionaryLookup</key>
	<false/>
	<key>allowDisplayMirroring</key>
	<false/>
	<key>allowDownUploads</key>
	<false/>
	<key>allowFlashFullscreen</key>
	<false/>
	<key>allowPDFPlugIn</key>
	<false/>
	<key>allowPreferencesWindow</key>
	<false/>
	<key>allowQuit</key>
	<false/>
	<key>allowScreenSharing</key>
	<false/>
	<key>allowSiri</key>
	<false/>
	<key>allowSpellCheck</key>
	<false/>
	<key>allowSwitchToApplications</key>
	<false/>
	<key>allowUserAppFolderInstall</key>
	<false/>
	<key>allowUserSwitching</key>
	<false/>
	<key>allowVideoCapture</key>
	<false/>
	<key>allowVirtualMachine</key>
	<false/>
	<key>allowWlan</key>
	<true/>
	<key>allowedDisplayBuiltin</key>
	<true/>
	<key>allowedDisplaysMaxNumber</key>
	<integer>1</integer>
	<key>blockPopUpWindows</key>
	<true/>
	<key>browserExamKeySalt</key>
	<data></data>
	<key>browserScreenKeyboard</key>
	<false/>
	<key>browserURLSalt</key>
	<true/>
	<!-- Full screen with SEB's taskbar/dock drawn over the bottom edge. Pages leave a
	     band of SEB_TASKBAR_PX free there (app/globals.css), so it never covers the exam. -->
	<key>browserViewMode</key>
	<integer>1</integer>
	<key>browserWindowAllowReload</key>
	<false/>
	<key>browserWindowShowURL</key>
	<integer>0</integer>
	<key>browserWindowWebView</key>
	<integer>3</integer>
	<key>createNewDesktop</key>
	<true/>
	<key>detectStoppedProcess</key>
	<true/>
	<key>downloadAndOpenSebConfig</key>
	<false/>
	<key>downloadPDFFiles</key>
	<false/>
	<key>enableAltEsc</key>
	<false/>
	<key>enableAltF4</key>
	<false/>
	<key>enableAltMouseWheel</key>
	<false/>
	<key>enableAltTab</key>
	<false/>
	<key>enableAppSwitcherCheck</key>
	<true/>
	<key>enableBrowserWindowToolbar</key>
	<false/>
	<key>enableCtrlEsc</key>
	<false/>
	<key>enableEsc</key>
	<false/>
	<key>enableF1</key>
	<false/>
	<key>enableF10</key>
	<false/>
	<key>enableF11</key>
	<false/>
	<key>enableF12</key>
	<false/>
	<key>enableF2</key>
	<false/>
	<key>enableF3</key>
	<false/>
	<key>enableF4</key>
	<false/>
	<key>enableF5</key>
	<false/>
	<key>enableF6</key>
	<false/>
	<key>enableF7</key>
	<false/>
	<key>enableF8</key>
	<false/>
	<key>enableF9</key>
	<false/>
	<key>enableJava</key>
	<false/>
	<key>enableLogging</key>
	<false/>
	<key>enablePlugIns</key>
	<false/>
	<key>enablePrintScreen</key>
	<false/>
	<key>enablePrivateClipboard</key>
	<true/>
	<key>enableRightMouse</key>
	<false/>
	<key>enableSebBrowser</key>
	<true/>
	<key>enableStartMenu</key>
	<false/>
	<key>enableTouchExit</key>
	<integer>0</integer>
	<key>enableZoomPage</key>
	<false/>
	<key>enableZoomText</key>
	<false/>
	<key>examSessionClearCookiesOnEnd</key>
	<true/>
	<key>examSessionClearCookiesOnStart</key>
	<true/>
	<key>forceAppFolderInstall</key>
	<true/>
	<key>hideBrowserWindowToolbar</key>
	<true/>
	<key>hookKeys</key>
	<true/>
	<key>ignoreExitKeys</key>
	<true/>
	<key>ignoreQuitPassword</key>
	<false/>
	<key>insideSebEnableChangeAPassword</key>
	<false/>
	<key>insideSebEnableEaseOfAccess</key>
	<false/>
	<key>insideSebEnableLockThisComputer</key>
	<false/>
	<key>insideSebEnableLogOff</key>
	<false/>
	<key>insideSebEnableNetworkConnectionSelector</key>
	<false/>
	<key>insideSebEnableShutDown</key>
	<false/>
	<key>insideSebEnableStartTaskManager</key>
	<false/>
	<key>insideSebEnableSwitchUser</key>
	<false/>
	<key>insideSebEnableVmWareClientShade</key>
	<false/>
	<key>killExplorerShell</key>
	<true/>
	<key>mainBrowserWindowHeight</key>
	<string>100%</string>
	<key>mainBrowserWindowPositioning</key>
	<integer>1</integer>
	<key>mainBrowserWindowWidth</key>
	<string>100%</string>
	<key>monitorProcesses</key>
	<true/>
	<key>muteOnStart</key>
	<true/>
	<key>newBrowserWindowAllowReload</key>
	<false/>
	<key>newBrowserWindowByLinkBlockForeign</key>
	<true/>
	<key>newBrowserWindowByLinkPolicy</key>
	<integer>2</integer>
	<key>newBrowserWindowByScriptBlockForeign</key>
	<true/>
	<key>newBrowserWindowByScriptPolicy</key>
	<integer>2</integer>
	<key>pinEmbeddedCertificates</key>
	<false/>
	<key>prohibitedProcesses</key>
	<array>
		<dict><key>active</key><true/><key>identifier</key><string>com.teamviewer.TeamViewer</string><key>os</key><integer>1</integer></dict>
		<dict><key>active</key><true/><key>identifier</key><string>com.anydesk.AnyDesk</string><key>os</key><integer>1</integer></dict>
		<dict><key>active</key><true/><key>identifier</key><string>us.zoom.xos</string><key>os</key><integer>1</integer></dict>
		<dict><key>active</key><true/><key>identifier</key><string>com.discord.Discord</string><key>os</key><integer>1</integer></dict>
		<dict><key>active</key><true/><key>identifier</key><string>com.tinyspeck.slackmacgap</string><key>os</key><integer>1</integer></dict>
		<dict><key>active</key><true/><key>identifier</key><string>com.microsoft.teams</string><key>os</key><integer>1</integer></dict>
		<dict><key>active</key><true/><key>identifier</key><string>com.microsoft.teams2</string><key>os</key><integer>1</integer></dict>
		<dict><key>active</key><true/><key>identifier</key><string>org.whispersystems.signal-desktop</string><key>os</key><integer>1</integer></dict>
		<dict><key>active</key><true/><key>identifier</key><string>WhatsApp</string><key>os</key><integer>1</integer></dict>
		<dict><key>active</key><true/><key>identifier</key><string>Telegram</string><key>os</key><integer>1</integer></dict>
		<dict><key>active</key><true/><key>identifier</key><string>com.obsproject.obs-studio</string><key>os</key><integer>1</integer></dict>
		<dict><key>active</key><true/><key>identifier</key><string>com.apple.screencaptureui</string><key>os</key><integer>1</integer></dict>
		<dict><key>active</key><true/><key>identifier</key><string>com.apple.Screenshot</string><key>os</key><integer>1</integer></dict>
		<dict><key>active</key><true/><key>identifier</key><string>com.nssurge.NSSurge-Mac</string><key>os</key><integer>1</integer></dict>
		<dict><key>active</key><true/><key>identifier</key><string>com.proxyman.NSProxy</string><key>os</key><integer>1</integer></dict>
		<dict><key>active</key><true/><key>identifier</key><string>TeamViewer.exe</string><key>os</key><integer>2</integer></dict>
		<dict><key>active</key><true/><key>identifier</key><string>TeamViewer_Service.exe</string><key>os</key><integer>2</integer></dict>
		<dict><key>active</key><true/><key>identifier</key><string>tv_w32.exe</string><key>os</key><integer>2</integer></dict>
		<dict><key>active</key><true/><key>identifier</key><string>AnyDesk.exe</string><key>os</key><integer>2</integer></dict>
		<dict><key>active</key><true/><key>identifier</key><string>Zoom.exe</string><key>os</key><integer>2</integer></dict>
		<dict><key>active</key><true/><key>identifier</key><string>Discord.exe</string><key>os</key><integer>2</integer></dict>
		<dict><key>active</key><true/><key>identifier</key><string>Slack.exe</string><key>os</key><integer>2</integer></dict>
		<dict><key>active</key><true/><key>identifier</key><string>Teams.exe</string><key>os</key><integer>2</integer></dict>
		<dict><key>active</key><true/><key>identifier</key><string>WhatsApp.exe</string><key>os</key><integer>2</integer></dict>
		<dict><key>active</key><true/><key>identifier</key><string>Telegram.exe</string><key>os</key><integer>2</integer></dict>
		<dict><key>active</key><true/><key>identifier</key><string>obs64.exe</string><key>os</key><integer>2</integer></dict>
		<dict><key>active</key><true/><key>identifier</key><string>obs32.exe</string><key>os</key><integer>2</integer></dict>
		<dict><key>active</key><true/><key>identifier</key><string>ScreenSnippet.exe</string><key>os</key><integer>2</integer></dict>
		<dict><key>active</key><true/><key>identifier</key><string>SnippingTool.exe</string><key>os</key><integer>2</integer></dict>
		<dict><key>active</key><true/><key>identifier</key><string>ShareX.exe</string><key>os</key><integer>2</integer></dict>
		<dict><key>active</key><true/><key>identifier</key><string>Greenshot.exe</string><key>os</key><integer>2</integer></dict>
		<dict><key>active</key><true/><key>identifier</key><string>Gyazo.exe</string><key>os</key><integer>2</integer></dict>
		<dict><key>active</key><true/><key>identifier</key><string>LightShot.exe</string><key>os</key><integer>2</integer></dict>
		<dict><key>active</key><true/><key>identifier</key><string>procexp.exe</string><key>os</key><integer>2</integer></dict>
		<dict><key>active</key><true/><key>identifier</key><string>procexp64.exe</string><key>os</key><integer>2</integer></dict>
		<dict><key>active</key><true/><key>identifier</key><string>ProcessHacker.exe</string><key>os</key><integer>2</integer></dict>
		<dict><key>active</key><true/><key>identifier</key><string>Wireshark.exe</string><key>os</key><integer>2</integer></dict>
		<dict><key>active</key><true/><key>identifier</key><string>fiddler.exe</string><key>os</key><integer>2</integer></dict>
		<dict><key>active</key><true/><key>identifier</key><string>charles.exe</string><key>os</key><integer>2</integer></dict>
		<dict><key>active</key><true/><key>identifier</key><string>mitmproxy.exe</string><key>os</key><integer>2</integer></dict>
	</array>
	<key>proxySettingsPolicy</key>
	<integer>0</integer>
	<key>quitURL</key>
	<string>${origin}/student?seb=quit</string>
	<key>quitURLConfirm</key>
	<false/>
	<key>removeBrowserProfile</key>
	<true/>
	<key>removeLocalStorage</key>
	<true/>
	<key>restartExamPasswordProtected</key>
	<true/>
	<key>sebMode</key>
	<integer>0</integer>
	<key>sebServerFallback</key>
	<false/>
	<key>sendBrowserExamKey</key>
	<true/>
	<key>showInputLanguage</key>
	<false/>
	<key>showMenuBar</key>
	<false/>
	<key>showReloadButton</key>
	<false/>
	<key>showReloadWarning</key>
	<false/>
	<key>showTaskBar</key>
	<true/>
	<key>taskBarHeight</key>
	<integer>40</integer>
	<key>showTime</key>
	<false/>
	<key>startURL</key>
	<string>${origin}/seb/start</string>
	<key>startURLAppendQueryParameter</key>
	<true/>
	<key>touchOptimized</key>
	<false/>
	<key>URLFilterEnable</key>
	<false/>
	<key>URLFilterEnableContentFilter</key>
	<false/>
	<key>zoomMode</key>
	<integer>0</integer>
</dict>
</plist>`;
}
