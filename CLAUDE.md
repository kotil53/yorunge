# CLAUDE.md

> Repo dili Türkçe: kod yorumları, commit mesajları ve dokümanlar Türkçe.

## Büyük resim

**Yörünge**: tek dokunuşla oynanan, sonsuz ilerleyen bir arcade oyunu. Marka **kotiliy** (küçük harf): açılışta ve Ayarlar'da logo +
"kotiliy tarafından geliştirildi" künyesi (`.kotiliy-mark`, logo Enerji ile aynı), iletişim osmankotil@outlook.com. Kuyruklu yıldız bir
gezegenin yörüngesinde döner, dokununca teğet yönde fırlar ve bir sonraki gezegenin halkasına girer.

Yapı, Enerji Bağlantısı (`C:\dev\Enerji`) ile aynı ve orada sınanmış:

1. **Oyun**: [yorunge.html](yorunge.html). Tek dosya HTML + CSS + JS, harici kütüphane yok, Canvas ile çiziliyor.
   Tek IIFE, ES5 stili (`var`, fonksiyon ifadeleri). Bölümler 1–15 dosya içinde numaralı. Tarayıcıda
   doğrudan açılınca da çalışır.
2. **Capacitor sarmalayıcı**: [capacitor-app/](capacitor-app/). `sync.mjs` kökteki HTML'i
   `www/index.html` olarak kopyalar. `www/`, `android/`, `ios/` sürüm kontrolüne girmez; CI her
   derlemede `cap add` ile sıfırdan üretir. [apply-native-config.mjs](capacitor-app/scripts/apply-native-config.mjs)
   şunları taze native projeye işler: AdMob App ID, SDK 36, minSdk 24, iOS 15, UMP 2.6.0 sabiti ve
   admob 6.2.0 iOS ödüllü reklam köprü yaması.

Oyunu **her zaman** kökteki `yorunge.html` üzerinde düzenle. `www/` elle düzenlenmez.

Yerel Android derlemesi: `cd capacitor-app && npm ci && npm run add:android && cd android && ./gradlew assembleDebug`.
Bu makinede sistemdeki `JAVA_HOME` artık olmayan bir klasörü gösteriyor ve `ANDROID_HOME` tanımlı değil;
derlerken `JAVA_HOME="C:\Program Files\Eclipse Adoptium\jdk-21.0.12.101-hotspot"` ve
`ANDROID_HOME="%LOCALAPPDATA%\Android\Sdk"` ver.

## Sınama

- `yorunge.html#selftest`: fırlatma ve yakalama yönü, kombo puanı, görev üretimi ve günlük seri
  için assert'ler çalışır. Sonuç sekme başlığında (`OK` / `FAIL`) ve konsolda görünür.
- `yorunge.html#debug`: `window.__y()` oyun durumunu döndürür (test botları için). Normal açılışta tanımsızdır.

## Oyun sistemleri

- **Fizik**: dünya ~400 birim genişlikte, y aşağı doğru artar. Yörüngedeyken `a += dir*ws*dt`.
  Fırlatma hızı `(-sin a, cos a)*dir*FLY`. Uçuş ≤4 birimlik alt adımlarla ilerler (`flyStep`), böylece
  halkayı sıyıran atış kaçmaz. Yakalanınca dönüş yönü, geliş vektörünün çapraz çarpım işaretinden çıkar.
- **Ölüm**: boşluk (uçuş > `MAX_FLIGHT` ya da ekran dışı), ay (n ≥ 8, halkada döner), kara delik (n ≥ 25),
  yörünge çökmesi (`orbitWarn`: aynı gezegende 2 tur güvenli, 3. turda kırmızı uyarı, sonunda ölüm; öğretici bitene kadar kapalı).
  Hareketli gezegenler n ≥ 18'den itibaren gelir.
- **Sektörler ve kontrol noktaları**: her `SECTOR_LEN` (20) gezegen bir sektördür (`SECTORS`, 6 tanımlı). Daha sonra
  "Derin Uzay" gelir (`sectorDef`: tohumlu, rastgele iki baskın tehlike). Sektörün ilk gezegeni kontrol noktasıdır (`p.cp`).
  Ulaşınca bant çıkar, `run.cp` puanı kaydeder ve `cp.max` kalıcı olarak açılır. Arka plan teması sektöre göre değişir.
  Oyun sonunda "Kontrol noktasından" (`restartFromCheckpoint`) düğmesi çıkar: oyun başına ilki bedava, sonrakiler ödüllü
  reklamla. Ana menüdeki sektör seçici (`startSector`, `freshWorld`) açılmış sektörden başlatır.
- **Öğretici** (`tutStep`: 0 nişan, 1 kombo, 2 çökme, 3 bitti; yalnız bitince `tut` kaydedilir): 0'da fırlatma yönünde
  kesikli çizgi (`drawTutorial`), çizgi sonraki gezegenin halkasına değince (`aimHits`, uçuş düz çizgi) yeşil olur, hedef
  halka parlar, "DOKUN!" çıkar ve zaman 0.4x yavaşlar. 1'de yarım tur penceresi altın yay olarak çizilir. Çökme yalnız
  `tutStep >= 2` iken açıktır. Ayarlar'daki "Nasıl oynanır" (`btnTutorial`) öğreticiyi sıfırlar.
- **Efektler**: `wave()` dünya koordinatında genişleyen şok halkası (fırlatma, konma; komboyla büyür, kontrol noktası,
  kalkan, ölüm). `slowmo(k, sn)` zaman ölçeği: kombo ≥ 3'te 80 ms hit-stop, kontrol noktası ve ölümde yavaş çekim; `frame`
  içinde öğretici yavaşlatmasıyla en küçüğü alınır. Uçarken kuyruklu yıldız hız yönünde uzar. Hepsi `reduceMotion`'da kapalı.
  Intro: ışık hızı sonunda flaş (`.flash`), logo arkasından şok dalgası (`.wave`), kuyruklu yıldız `cometIn` ile yörüngeye girer.
- **Özel gezegenler** (`p.kind`): altın (+5 yıldız), buz (yavaş döner), pulsar (hızlı döner, +1 puan). Olasılıkları sektöre göre değişir.
- **Güçlendirmeler** (`world.powers`, uçarken toplanır): kalkan (bir ölümü önler, `die` içinde `rescue`), mıknatıs
  (10 sn yıldız çeker) ve 2x puan (12 sn).
- **Kombo**: yarım turdan önce atlamak "hızlı" sayılır ve kombo artar (en çok x5). Puan = kombo.
- **Ekonomi** (`Store`, `yorunge.v1.` öneki): yıldız (`coins`), rekor (`best`), kostümler (`skins`/`skin`),
  günlük görevler (`missions`, tarih tohumlu 3 görev), günlük ödül serisi (`daily.*`, 7 gün; bir gün
  kaçırılırsa 1. güne döner).
- **Reklam** (`Ads`, `ADS_CFG`, `AD_UNITS`):
  - Ödüllü geçiş reklamı iki yerde: "kaldığın yerden devam" (oyun başına 1, puan ≥ 3) ve
    "yıldızları / günlük ödülü 2 kat al".
  - Geçiş reklamı ilk 3 oyundan sonra, her 3 oyunda bir, araya en az 60 sn koyarak Tekrar ya da Menü'de çıkar.
  - Banner yalnız menülerde görünür, oyun sırasında gizlenir.
  - **Tuzak:** ödül `Dismissed` olayında teslim edilir. Ayrıntı modülün yorumunda.
- **Sıralama**: ana menüdeki kupa rozeti açar, iki sekme var.
  - **Dünya** (`Online`, `ONLINE_CFG`): tüm oyuncuların takma adlı ortak listesi (Supabase RPC). Sunucu tarafı ve
    güvenlik modeli [server/supabase.sql](server/supabase.sql) içinde: tabloya doğrudan erişim kapalı, yalnız
    `submit_score` / `top_scores` / `my_rank`. Her cihaz rastgele `online.id` + `online.secret` üretir, satırı yalnız
    anahtar sahibi günceller. Ad kuralı istemcide `NAME_RE`, sunucuda `yorunge_name_ok` (küfür listesi yalnız sunucuda).
    Oyun sonunda gönderilmemiş rekor `Online.sync()` ile gönderilir. `ONLINE_CFG.URL` boşsa sekme "yakında" der.
    Sunucudan gelen adlar yalnız `textContent` ile yazılır.
  - **Benim** (`Ranks`, `scores` anahtarı): bu cihazdaki en iyi 10 oyun. Devam ve kontrol noktası aynı oyunu
    sürdürür (`run.rid`), tek satır güncellenir.
- **Ses** (`Sound`, dosya yok, WebAudio sentezi): müzik 16'lık adımlı bir sıralayıcı (`_tick` / `_stepAt`, 50 ms'lik
  ileri planlama). Her sektörün `MOODS` içinde kendi ruh hali var (ton, mod, tempo, akor dizisi, arpej); menü ve
  oyun dışı için `MOOD_MENU` çalar. Derin Uzay'da ruh halleri dörtlü yukarı taşınarak tekrar eder. Ruh hali ölçü
  başında `Sound.getState` ile güncellenir. Davul yalnız oyunda çalar, kombo ≥ 3 olunca hihat sıklaşır. Efektler
  (`land`, `coin`, `fanfare`…) notalarını o anki ruh halinin pentatonik dizisinden (`_deg`) alır.
- **Bildirim** (`Notify`): yerel bildirimler 1., 3. ve 7. günde saat 19:00'da. İzin ilk oyun sonunda istenir.
- **Dil**: tr/en, cihaz dilinden seçilir. Yeni dil eklemek için `LANGS`, `I18N`, Ayarlar'daki `data-lang`
  düğmesi ve `apply-native-config.mjs` içindeki `APP_LANGS` güncellenmeli.

## Yayın kontrol listesi

1. AdMob'da "Yörünge" uygulamasını (Android + iOS) aç. Birim ID'lerini `AD_UNITS.live`'a yaz ve
   `ADS_CFG.TEST_MODE = false` yap.
2. GitHub sırları: `ADMOB_APP_ID_ANDROID`, `ADMOB_APP_ID_IOS`, Android imzalama sırları
   (`ANDROID_KEYSTORE_BASE64`, …) ve App Store sırları (`APPSTORE_*`). Adlar Enerji ile aynı;
   iş akışları [.github/workflows](.github/workflows) içinde.
3. App Store Connect'te `com.kotilgames.yorunge` paket kimliğiyle uygulama kaydı aç, Play Console'da yeni uygulama oluştur.
4. Gizlilik politikası [docs/privacy-policy.html](docs/privacy-policy.html) (GitHub Pages, `main` / `/docs`):
   `https://kotil53.github.io/yorunge/privacy-policy.html`. Ayarlar ekranındaki bağlantı bu adrese gider, bu yüzden
   GitHub deposunun adı `kotil53/yorunge` olmalı. Reklam/izleme beyanları (AdMob + ATT) mağaza formlarına girilir. Dünya
   sıralaması takma ad + puan + rastgele cihaz kimliği topluyor; veri güvenliği formunda da belirtilmeli.
5. Dünya sıralaması **kurulu**: Supabase projesi `yorunge` (ref `iooqwrezjlxlksjwxklt`, Frankfurt, org "kotil53's Org").
   SQL değişirse `server/supabase.sql`'i SQL Editor'de yeniden çalıştır (tekrar çalıştırmak güvenli). `ONLINE_CFG`'de
   yalnız **anon** anahtar durur; service_role anahtarı asla oyuna girmez. Veritabanı şifresi depoda değil, Osman'da.
6. Yayın öncesinde SkillSpector taraması yapılır (bkz. kullanıcı CLAUDE.md).
