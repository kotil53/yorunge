// `npx cap add` ile TAZE üretilen native projeye, README'de elle yapılması
// istenen düzenlemeleri otomatik uygular. Böylece CI her derlemede sıfırdan
// `cap add` yapsa bile sonuç tekrarlanabilir olur.
//
// Yaptıkları (hepsi idempotent — ikinci kez çalıştırmak zararsız):
//   1. AdMob native "APPLICATION_ID" — Android AndroidManifest.xml + iOS Info.plist
//      (yoksa Android'de uygulama açılışta çöker)
//   2. iOS: NSUserTrackingUsageDescription (ATT metni) + ITSAppUsesNonExemptEncryption=false
//      (App Store "Missing Compliance" / ihracat şifreleme sorusu bir daha çıkmaz)
//   3. Android: build.gradle içinde versionCode / versionName
//   4. iOS: Podfile'a GoogleUserMessagingPlatform 2.6.0 sabiti (+ gerekiyorsa
//      pod install) — admob 6.2.0 eski UMP 2.x API'si kullanır, CocoaPods
//      varsayılanı UMP 3.x pod Swift derlemesini kırar
//   5. iOS: @capacitor-community/admob 6.2.0 AdMobPlugin.swift yaması —
//      prepare/showRewardInterstitialAd bridge listesine eklenir (eksik;
//      olmadan iOS'ta ödüllü reklam "not implemented" ile reddediliyor)
//
// Ortam değişkenleri (hepsi opsiyonel — verilmezse Google'ın TEST değerleri):
//   ADMOB_APP_ID_ANDROID   varsayılan: ca-app-pub-3940256099942544~3347511713
//   ADMOB_APP_ID_IOS       varsayılan: ca-app-pub-3940256099942544~1458002511
//   ANDROID_VERSION_CODE   varsayılan: 1
//   APP_VERSION            varsayılan: package.json > version
//
// Kullanım:  node scripts/apply-native-config.mjs

import { readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

const ADMOB_ANDROID = process.env.ADMOB_APP_ID_ANDROID || "ca-app-pub-3940256099942544~3347511713";
const ADMOB_IOS     = process.env.ADMOB_APP_ID_IOS     || "ca-app-pub-3940256099942544~1458002511";
const VERSION_CODE  = process.env.ANDROID_VERSION_CODE || "1";
const VERSION_NAME  = process.env.APP_VERSION || pkg.version || "1.0.0";
const ATT_TEXT      = "Reklamları ilgi alanlarınıza göre kişiselleştirmek için kullanılır.";

let touched = 0;
const log = (m) => { console.log("  " + m); touched++; };
const patch = (file, fn) => {
  if (!existsSync(file)) return;
  const before = readFileSync(file, "utf8");
  const after = fn(before);
  if (after !== before) writeFileSync(file, after);
};

// ── Android ──────────────────────────────────────────────────────
const manifest = join(root, "android/app/src/main/AndroidManifest.xml");
patch(manifest, (xml) => {
  if (xml.includes("com.google.android.gms.ads.APPLICATION_ID")) return xml;
  const meta =
    `\n        <meta-data\n` +
    `            android:name="com.google.android.gms.ads.APPLICATION_ID"\n` +
    `            android:value="${ADMOB_ANDROID}" />\n`;
  const m = xml.match(/<application[^>]*>/);
  if (!m) { console.warn("  ! AndroidManifest.xml: <application> bulunamadı"); return xml; }
  log(`AndroidManifest.xml  +AdMob APPLICATION_ID (${ADMOB_ANDROID})`);
  return xml.replace(m[0], m[0] + meta);
});

const buildGradle = join(root, "android/app/build.gradle");
patch(buildGradle, (g) => {
  let out = g
    .replace(/versionCode\s+\d+/, `versionCode ${VERSION_CODE}`)
    .replace(/versionName\s+"[^"]*"/, `versionName "${VERSION_NAME}"`);
  if (out !== g) log(`build.gradle          versionCode=${VERSION_CODE} versionName="${VERSION_NAME}"`);
  return out;
});

// Play Console, yüklenen sürümün hedeflediği API düzeyinin Google'ın o anki
// asgari şartını karşılamasını istiyor (her yıl yükseliyor); Capacitor 6
// varsayılanı (34) altında kalınca kapalı test/production yüklemesi
// "1 hata" ile reddediliyor. compileSdk'yı da aynı hizada tutmak gerekiyor;
// bu ikisi eski AGP/Gradle ile derlenemeyebileceği için ikisini de yükseltiyoruz.
const variablesGradle = join(root, "android/variables.gradle");
patch(variablesGradle, (g) => {
  const out = g
    .replace(/compileSdkVersion\s*=\s*\d+/, "compileSdkVersion = 36")
    .replace(/targetSdkVersion\s*=\s*\d+/, "targetSdkVersion = 36");
  if (out !== g) log("variables.gradle      compile/targetSdkVersion -> 36 (Play Console asgari şartı)");
  return out;
});

// Play Console'da "otomatik koruma" açıkken minSdk en az 24 olmalı; Capacitor 6
// varsayılanı (22) yüklemede "minimum SDK sürümü 24 veya daha yüksek olmalı"
// hatasıyla reddediliyor. 24 = Android 7.0 (cihazların büyük çoğunluğu).
patch(variablesGradle, (g) => {
  const out = g.replace(/minSdkVersion\s*=\s*\d+/, "minSdkVersion = 24");
  if (out !== g) log("variables.gradle      minSdkVersion -> 24 (Play otomatik koruma şartı)");
  return out;
});

const rootBuildGradle = join(root, "android/build.gradle");
patch(rootBuildGradle, (g) => {
  const out = g.replace(/com\.android\.tools\.build:gradle:[\d.]+/, "com.android.tools.build:gradle:8.7.2");
  if (out !== g) log("build.gradle (root)   Android Gradle Plugin -> 8.7.2 (compileSdk 36 desteği)");
  return out;
});

const gradleWrapperProps = join(root, "android/gradle/wrapper/gradle-wrapper.properties");
patch(gradleWrapperProps, (g) => {
  const out = g.replace(/gradle-[\d.]+-all\.zip/, "gradle-8.9-all.zip");
  if (out !== g) log("gradle-wrapper.properties  Gradle -> 8.9 (AGP 8.7.2 gereksinimi)");
  return out;
});

// ── iOS ──────────────────────────────────────────────────────────
const plist = join(root, "ios/App/App/Info.plist");
patch(plist, (p) => {
  if (p.includes("GADApplicationIdentifier")) return p;
  const keys =
    `\t<key>GADApplicationIdentifier</key>\n\t<string>${ADMOB_IOS}</string>\n` +
    `\t<key>NSUserTrackingUsageDescription</key>\n\t<string>${ATT_TEXT}</string>\n`;
  const idx = p.lastIndexOf("</dict>");
  if (idx < 0) { console.warn("  ! Info.plist: </dict> bulunamadı"); return p; }
  log(`Info.plist            +GADApplicationIdentifier (${ADMOB_IOS}) +ATT`);
  return p.slice(0, idx) + keys + p.slice(idx);
});

// Oyun yalnız sistemin HTTPS'ini kullanıyor (özel şifreleme yok) -> ihracat uyumu
// açısından muaf. Bu anahtar olmadan her TestFlight/App Store yüklemesinde
// "Missing Compliance" çıkıp elle yanıt bekliyor.
patch(plist, (p) => {
  if (p.includes("ITSAppUsesNonExemptEncryption")) return p;
  const idx = p.lastIndexOf("</dict>");
  if (idx < 0) { console.warn("  ! Info.plist: </dict> bulunamadı"); return p; }
  log("Info.plist            +ITSAppUsesNonExemptEncryption=false (App Store ihracat uyumu sorusu atlanır)");
  return p.slice(0, idx) + `\t<key>ITSAppUsesNonExemptEncryption</key>\n\t<false/>\n` + p.slice(idx);
});

// Oyun dilleri JS tarafında çevriliyor (bundle'da .lproj yok). iOS, uygulamanın
// hangi dilleri desteklediğini CFBundleLocalizations'tan öğrenir; bildirilmezse
// WebView cihaz dilini değil geliştirme bölgesini (en) bildirebilir ve oyun her
// ülkede İngilizce açılır. Aynı liste App Store sayfasında "Diller" olarak görünür.
// Liste, yorunge.html > LANGS ile aynı tutulmalı.
const APP_LANGS = ["tr", "en"];
patch(plist, (p) => {
  if (p.includes("CFBundleLocalizations")) return p;
  const idx = p.lastIndexOf("</dict>");
  if (idx < 0) { console.warn("  ! Info.plist: </dict> bulunamadı"); return p; }
  log(`Info.plist            +CFBundleLocalizations (${APP_LANGS.join(", ")})`);
  const items = APP_LANGS.map((l) => `\t\t<string>${l}</string>\n`).join("");
  return p.slice(0, idx) + `\t<key>CFBundleLocalizations</key>\n\t<array>\n${items}\t</array>\n` + p.slice(idx);
});

// Minimum iOS sürümü: Capacitor 6 varsayılanı 13.0 -> Apple ITMS-90068 uyarısı veriyor
// ("2027 baharından itibaren MinimumOSVersion 15.0+ olmalı"). Şimdiden 15.0'a çek.
// App hedefinin IPHONEOS_DEPLOYMENT_TARGET'ı MinimumOSVersion'ı belirler; Podfile
// `platform` satırı da Pod'lara aynı tabanı geçirir (assertDeploymentTarget).
const pbxproj = join(root, "ios/App/App.xcodeproj/project.pbxproj");
patch(pbxproj, (s) => {
  if (!s.includes("IPHONEOS_DEPLOYMENT_TARGET = 13.0")) return s;
  log("project.pbxproj       IPHONEOS_DEPLOYMENT_TARGET 13.0 -> 15.0 (ITMS-90068)");
  return s.replace(/IPHONEOS_DEPLOYMENT_TARGET = 13\.0;/g, "IPHONEOS_DEPLOYMENT_TARGET = 15.0;");
});

// @capacitor-community/admob 6.2.0 iOS hatası: prepareRewardInterstitialAd /
// showRewardInterstitialAd fonksiyonları tanımlı ama CAPBridgedPlugin
// `pluginMethods` listesine eklenmemiş -> iOS'ta JS'ten çağrılınca "not
// implemented" (Android reflection kullandığı için etkilenmez -> Android'de
// ödüllü reklam çıkıyor, iOS'ta çıkmıyordu). 6.x'te düzelten sürüm yok
// (7.x Capacitor 7 ister). node_modules kaynağını yamalıyoruz; pod install
// eklenti dosyalarını buradan kopyalar.
const admobSwift = join(root, "node_modules/@capacitor-community/admob/ios/Sources/AdMobPlugin/AdMobPlugin.swift");
let admobSwiftPatched = false;
patch(admobSwift, (s) => {
  if (s.includes('name: "showRewardInterstitialAd"')) return s;
  const anchor = 'CAPPluginMethod(name: "showRewardVideoAd", returnType: CAPPluginReturnPromise)';
  if (!s.includes(anchor)) { console.warn("  ! AdMobPlugin.swift: pluginMethods enjeksiyon noktası bulunamadı"); return s; }
  admobSwiftPatched = true;
  log("AdMobPlugin.swift    +prepare/showRewardInterstitialAd köprüsü (6.2.0 eksiği)");
  return s.replace(anchor,
    anchor +
    ',\n        CAPPluginMethod(name: "prepareRewardInterstitialAd", returnType: CAPPluginReturnPromise)' +
    ',\n        CAPPluginMethod(name: "showRewardInterstitialAd", returnType: CAPPluginReturnPromise)');
});

// admob 6.2.0 -> UMP 2.x API. CocoaPods varsayılanı UMP 3.x (sembol rename) ->
// CapacitorCommunityAdmob pod Swift derlemesi kırılır. GMA 11.3.0 yalnız
// "GoogleUserMessagingPlatform >= 1.1" istediği için son 2.x'e (2.6.0) sabitle.
const podfile = join(root, "ios/App/Podfile");
let podfileChanged = false;
patch(podfile, (pf) => {
  if (pf.includes("GoogleUserMessagingPlatform")) return pf;
  const pin = `  pod 'GoogleUserMessagingPlatform', '2.6.0'\n`;
  let out;
  if (pf.includes("# Add your Pods here")) {
    out = pf.replace("# Add your Pods here\n", "# Add your Pods here\n" + pin);
  } else {
    const m = pf.match(/(target 'App' do\n\s*capacitor_pods\n)/);
    if (!m) { console.warn("  ! Podfile: enjeksiyon noktası bulunamadı"); return pf; }
    out = pf.replace(m[0], m[0] + pin);
  }
  if (out !== pf) { podfileChanged = true; log("Podfile              +GoogleUserMessagingPlatform 2.6.0 (UMP 2.x sabiti)"); }
  return out;
});

// Pod tabanını da 15.0'a çek (yukarıdaki pbxproj ile aynı gerekçe — ITMS-90068).
patch(podfile, (pf) => {
  const out = pf.replace(/^platform :ios, ['"]13\.0['"]/m, "platform :ios, '15.0'");
  if (out !== pf) { podfileChanged = true; log("Podfile              platform :ios 13.0 -> 15.0 (ITMS-90068)"); }
  return out;
});

// Podfile değiştiyse Pods'u yeniden kur (yalnız CocoaPods varsa — Windows/Android CI'da atlanır).
// `cap add ios` ilk pod install'da Podfile.lock'a UMP 3.x kilitliyor; düz `pod install`
// kilide karşı downgrade edemez → lock + Pods/ silinip tam yeniden çözüm yaptırılır.
if (podfileChanged || admobSwiftPatched) {
  let hasPod = true;
  try { execSync("pod --version", { stdio: "ignore" }); }
  catch { hasPod = false; console.warn("  ! pod install atlandı — CocoaPods bulunamadı"); }
  if (hasPod) {
    const appDir = join(root, "ios/App");
    rmSync(join(appDir, "Podfile.lock"), { force: true });
    rmSync(join(appDir, "Pods"), { recursive: true, force: true });
    console.log("  pod install (Podfile.lock + Pods/ silindi, yeniden çözülüyor)…");
    execSync("pod install", { cwd: appDir, stdio: "inherit" });  // hata olursa script çöksün
  }
}

console.log(touched ? `✓ Native yapılandırma uygulandı (${touched} değişiklik)` : "✓ Native yapılandırma zaten güncel");
