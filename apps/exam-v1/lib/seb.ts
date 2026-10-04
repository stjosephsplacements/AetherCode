import { createHash, randomBytes, pbkdf2Sync, createCipheriv, createHmac } from "node:crypto";
import { gzipSync } from "node:zlib";

// SEB sends X-SafeExamBrowser-RequestHash = SHA256(pageUrl + browserExamKey) in hex.
// sebExamKey is one BEK hash per line (supports multiple SEB versions/platforms).
// Returns true if the request is from a valid SEB instance.
export function isSebRequest(pageUrl: string, requestHash: string | null, sebExamKey: string): boolean {
  if (!requestHash) return false;
  const keys = sebExamKey
    .split(/\r?\n/)
    .map((line) => line.trim().toLowerCase())
    .filter(Boolean);
  if (keys.length === 0) return false;
  // Strip fragment from URL before hashing (SEB spec requirement).
  const urlWithoutFragment = pageUrl.split("#")[0];
  for (const key of keys) {
    const expected = createHash("sha256")
      .update(urlWithoutFragment + key, "utf8")
      .digest("hex");
    if (expected === requestHash.toLowerCase()) return true;
  }
  return false;
}

// Encrypt data using RNCryptor v1 format (password-based, AES-256-CBC + HMAC-SHA256).
// Format: version(1) | options(1) | encSalt(8) | hmacSalt(8) | iv(16) | ciphertext | hmac(32)
function rncryptorEncrypt(plaintext: Buffer, password: string): Buffer {
  const version = Buffer.from([0x02]);
  const options = Buffer.from([0x01]);
  const encSalt = randomBytes(8);
  const hmacSalt = randomBytes(8);
  const iv = randomBytes(16);

  const encKey = pbkdf2Sync(password, encSalt, 10_000, 32, "sha1");
  const hmacKey = pbkdf2Sync(password, hmacSalt, 10_000, 32, "sha1");

  const cipher = createCipheriv("aes-256-cbc", encKey, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);

  const hmacData = Buffer.concat([version, options, encSalt, hmacSalt, iv, ciphertext]);
  const hmac = createHmac("sha256", hmacKey).update(hmacData).digest();

  return Buffer.concat([hmacData, hmac]);
}

// Build an encrypted .seb config file for the given exam.
// password: the exam admin password (used to encrypt and also required for quitting SEB).
// startUrl: full URL SEB opens after loading the config.
// quitUrl: full URL that triggers SEB to auto-quit when navigated to.
export function buildSebConfig(options: {
  title: string;
  password: string;
  startUrl: string;
  quitUrl: string;
}): Buffer {
  const plistXml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<!-- ── Session ── -->
	<key>startURL</key>
	<string>${options.startUrl}</string>
	<key>quitURL</key>
	<string>${options.quitUrl}</string>
	<key>quitURLConfirm</key>
	<false/>
	<key>ignoreExitKeys</key>
	<true/>
	<key>ignoreQuitPassword</key>
	<false/>
	<key>restartExamPasswordProtected</key>
	<true/>
	<key>examSessionClearCookiesOnStart</key>
	<true/>
	<key>examSessionClearCookiesOnEnd</key>
	<true/>
	<key>removeBrowserProfile</key>
	<true/>
	<key>removeLocalStorage</key>
	<true/>

	<!-- ── Browser exam key / integrity ── -->
	<key>sendBrowserExamKey</key>
	<true/>
	<key>browserExamKeySalt</key>
	<data></data>
	<key>browserURLSalt</key>
	<true/>
	<key>browserWindowWebView</key>
	<integer>3</integer>

	<!-- ── Kiosk / UI lockdown ── -->
	<key>browserViewMode</key>
	<integer>1</integer>
	<key>mainBrowserWindowWidth</key>
	<string>100%</string>
	<key>mainBrowserWindowHeight</key>
	<string>100%</string>
	<key>mainBrowserWindowPositioning</key>
	<integer>1</integer>
	<key>showTaskBar</key>
	<false/>
	<key>showMenuBar</key>
	<false/>
	<key>showTime</key>
	<false/>
	<key>showInputLanguage</key>
	<false/>
	<key>enableBrowserWindowToolbar</key>
	<false/>
	<key>hideBrowserWindowToolbar</key>
	<true/>
	<key>browserWindowShowURL</key>
	<integer>0</integer>
	<key>allowPreferencesWindow</key>
	<false/>
	<key>allowQuit</key>
	<false/>
	<key>showReloadButton</key>
	<false/>
	<key>showReloadWarning</key>
	<false/>
	<key>browserWindowAllowReload</key>
	<false/>
	<key>newBrowserWindowAllowReload</key>
	<false/>
	<key>allowBrowsingBackForward</key>
	<false/>
	<key>newBrowserWindowByLinkPolicy</key>
	<integer>2</integer>
	<key>newBrowserWindowByScriptPolicy</key>
	<integer>2</integer>
	<key>newBrowserWindowByLinkBlockForeign</key>
	<true/>
	<key>newBrowserWindowByScriptBlockForeign</key>
	<true/>
	<key>blockPopUpWindows</key>
	<true/>
	<key>enableRightMouse</key>
	<false/>
	<key>allowDownUploads</key>
	<false/>
	<key>downloadPDFFiles</key>
	<false/>
	<key>openDownloads</key>
	<false/>
	<key>allowPDFPlugIn</key>
	<false/>
	<key>allowFlashFullscreen</key>
	<false/>
	<key>enableZoomPage</key>
	<false/>
	<key>enableZoomText</key>
	<false/>
	<key>zoomMode</key>
	<integer>0</integer>
	<key>enableJava</key>
	<false/>
	<key>enablePlugIns</key>
	<false/>
	<key>browserScreenKeyboard</key>
	<false/>
	<key>touchOptimized</key>
	<false/>
	<key>enableTouchExit</key>
	<integer>0</integer>

	<!-- ── Anti-bypass: VM / remote desktop ── -->
	<key>allowVirtualMachine</key>
	<false/>
	<key>allowScreenSharing</key>
	<false/>
	<key>allowSwitchToApplications</key>
	<false/>

	<!-- ── Anti-bypass: process monitoring ── -->
	<key>enableAppSwitcherCheck</key>
	<true/>
	<key>monitorProcesses</key>
	<true/>
	<key>detectStoppedProcess</key>
	<true/>
	<key>sebServicePolicy</key>
	<integer>2</integer>
	<key>prohibitedProcesses</key>
	<array>
		<!-- macOS (os=1): kill by bundle identifier or app name -->
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
		<!-- Windows (os=2): kill by executable name -->
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

	<!-- ── Clipboard isolation ── -->
	<key>enablePrivateClipboard</key>
	<true/>

	<!-- ── Display ── -->
	<key>allowDisplayMirroring</key>
	<false/>
	<key>allowedDisplaysMaxNumber</key>
	<integer>1</integer>
	<key>allowedDisplayBuiltin</key>
	<true/>
	<key>allowAirPlay</key>
	<false/>

	<!-- ── Media / peripherals ── -->
	<key>allowVideoCapture</key>
	<false/>
	<key>allowAudioCapture</key>
	<false/>
	<key>enableAudioControl</key>
	<true/>
	<key>muteOnStart</key>
	<true/>
	<key>allowSiri</key>
	<false/>

	<!-- ── Input / spell ── -->
	<key>allowSpellCheck</key>
	<false/>
	<key>allowDictation</key>
	<false/>
	<key>allowDictionaryLookup</key>
	<false/>

	<!-- ── Network ── -->
	<key>allowWlan</key>
	<true/>
	<key>proxySettingsPolicy</key>
	<integer>0</integer>

	<!-- ── macOS specific ── -->
	<key>forceAppFolderInstall</key>
	<true/>
	<key>allowUserSwitching</key>
	<false/>
	<key>allowUserAppFolderInstall</key>
	<false/>

	<!-- ── Windows: isolated desktop + full keyboard lockdown ── -->
	<key>createNewDesktop</key>
	<true/>
	<key>killExplorerShell</key>
	<true/>
	<key>hookKeys</key>
	<true/>
	<key>enablePrintScreen</key>
	<false/>
	<key>enableAltTab</key>
	<false/>
	<key>enableAltF4</key>
	<false/>
	<key>enableAltEsc</key>
	<false/>
	<key>enableAltMouseWheel</key>
	<false/>
	<key>enableCtrlEsc</key>
	<false/>
	<key>enableEsc</key>
	<false/>
	<key>enableStartMenu</key>
	<false/>
	<key>enableF1</key>
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
	<key>enableF10</key>
	<false/>
	<key>enableF11</key>
	<false/>
	<key>enableF12</key>
	<false/>
	<key>insideSebEnableStartTaskManager</key>
	<false/>
	<key>insideSebEnableLogOff</key>
	<false/>
	<key>insideSebEnableShutDown</key>
	<false/>
	<key>insideSebEnableLockThisComputer</key>
	<false/>
	<key>insideSebEnableSwitchUser</key>
	<false/>
	<key>insideSebEnableVmWareClientShade</key>
	<false/>
	<key>insideSebEnableChangeAPassword</key>
	<false/>
	<key>insideSebEnableEaseOfAccess</key>
	<false/>
	<key>insideSebEnableNetworkConnectionSelector</key>
	<false/>

	<!-- ── Misc ── -->
	<key>enableLogging</key>
	<false/>
	<key>enableSebBrowser</key>
	<true/>
	<key>sebMode</key>
	<integer>0</integer>
	<key>downloadAndOpenSebConfig</key>
	<false/>
	<key>URLFilterEnable</key>
	<false/>
	<key>URLFilterEnableContentFilter</key>
	<false/>
	<key>pinEmbeddedCertificates</key>
	<false/>
	<key>sebServerFallback</key>
	<false/>
</dict>
</plist>`;

  // Inner: gzip compress the plist XML
  const innerGz = gzipSync(Buffer.from(plistXml, "utf8"));

  // Password-encrypt using RNCryptor v1
  const encrypted = rncryptorEncrypt(innerGz, options.password);

  // Prepend "pswd" prefix
  const withPrefix = Buffer.concat([Buffer.from("pswd"), encrypted]);

  // Outer: gzip compress the whole thing
  return gzipSync(withPrefix);
}
