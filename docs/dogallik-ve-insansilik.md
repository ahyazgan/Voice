# Doğallık & İnsansılık Planı — Türkçe Sesli Tahsilat Ajanı

> Ürünün mimaride yazılı asıl farklılaştırıcısı **Türkçe TTS doğallığı**
> (ARCHITECTURE.md §10.2). Ama `iyilestirme-plani.md` para/KVKK/güvenlik
> katmanlarına odaklı; doğallık orada ayrı bir başlık değildi. Bu doküman o
> boşluğu doldurur: insansılığı kendi katmanı olarak, ölçülebilir ve
> önceliklendirilmiş şekilde takip eder.

---

## 0. İnce düşünme merceği (metot)

İnsansılık tek bir özellik değil; yüzlerce mikro-davranışın toplamı. Yeni fikir
üretirken kullanacağımız dört ilke:

1. **Özellikten değil, "ele veren an"dan (tell) düşün.** İyi giden 100 turu değil,
   robotu ele veren 1 anı avla. Asimetri acımasız: tek bir kötü tell (acı bir
   girdiye anlık cevap) önceki tüm doğallığı bir saniyede çöpe atar. Önce en kötü
   tell'leri öldür.
2. **"Konuşma edimi" birimiyle düşün.** Selamlama / kötü-haber / rakam okutma /
   itiraz / empati / kapanış — her birinin kendine has insan imzası var; tek TTS
   ayarı hepsine uymaz.
3. **Kanal kısıtını içselleştir.** 8kHz telefon bandı tizi öldürür. Doğallık ses
   *kalitesinden* değil **zamanlama + prozodi + kelime seçiminden** gelir.
   Kulaklıkta değil, gerçek hatta test et.
4. **Doğallık amaç değil, araç.** Ölçüt "kulağa hoş geliyor mu" değil; **tahsilat
   oranı / aramayı tamamlama / öfke oranı** değişti mi.

---

## 1. ŞİMDİ ekleyeceklerimiz (bu çalışmanın kapsamı) — ✅ UYGULANDI

> Tümü kodlandı, `pnpm typecheck` + `pnpm test` yeşil. Gerçek hat (8kHz)
> kalibrasyonu gereken yerler işaretli.

### Hızlı kazanımlar (düşük efor, yüksek/risksiz)
- [x] **ElevenLabs ayarlarını aç** (`elevenlabs.ts`, `config.ts`): `style`,
  `use_speaker_boost`, `optimize_streaming_latency` config'e açıldı; ton artık
  durum-bazlı (`voiceToneForState`). ⏳ değerlerin 8kHz hatta A/B kalibrasyonu kaldı.
- [x] **Normalizasyonu genişlet** (`ttsNormalize.ts`): yüzde ("%25"→"yüzde yirmi beş"),
  saat ("14:30"→"on dört otuz"), telefon ve IBAN (rakam rakam) eklendi. Sıra sayıları
  yanlış-pozitif riski (cümle sonu nokta) nedeniyle bilinçli ertelendi → §3.
- [x] **Backchannel bağlı** (`orchestrator.ts:88`): AI konuşurken gelen "hı hı/tamam"
  zaten tur sayılmıyor (plan notu güncelliğini yitirmişti — doğrulandı).

### Algıda en büyük sıçrama (orta efor)
- [x] **Değişken cevap gecikmesi + duygusal mikro-pause** (`naturalness.ts`,
  `orchestrator.ts`): müşteri zorluk belirtince (`detectEmotionalCue`) cevaptan ÖNCE
  `NATURALNESS_EMPATHY_PAUSE_MS` (varsayılan 600ms) duraklar; nötr girdide 0 (KPI korunur).
- [x] **Gecikme maskeleme (dolgu sesi)** (`pickThinkingFiller`): kodlandı + rotasyonlu.
  ⏳ `NATURALNESS_THINKING_FILLER` ile **kapalı varsayılan** — fazla gevezelik ters
  tepebileceğinden gerçek hatta kalibre edilene dek kapalı; açılınca devreye girer.
- [x] **Geri referans (within-call memory)** (`prompts/index.ts`): "az önce 15'inde
  dediniz ya", anafora kullanımı prompt'a işlendi.
- [x] **Duruma göre TTS tonu** (`voiceToneForState`): negotiate/empati sıcak (stability↓,
  style↑), confirm net (stability↑), escalate yumuşak.

### Prompt'a işlenen ince davranışlar (`prompts/index.ts`)
- [x] **Recipient design:** müşterinin kelimesini yankıla, üslubuna uy.
- [x] **Öz-düzeltme & söylem işaretleri:** "peki"/"şimdi"/"bakın" işleve bağlı.
- [x] **Belirsizlikte onar, tahmin etme:** "15 mi 50 mi" emin değilse sor.
- [x] **Utanç azaltma:** yüz kurtaran, suçlamayan dil; empati şablonu değil spesifik.
- [x] **Talepten sonra sessizliği kullan:** tek soru sor, sus, dinle.

---

## 2. Tell Envanteri (yanılsamayı kıran anlar → kod karşılığı)

| # | Tell (ele veren an) | Kök neden | Çözüm katmanı | Öncelik |
|---|---|---|---|---|
| T1 | Acı girdiye anlık cevap | Sabit gecikme | Zamanlama (mikro-pause) | 🔴 |
| T2 | Para/tarihi robotik okuma | Normalizasyon eksiği | ttsNormalize + prozodi | 🔴 |
| T3 | Aynı kalıbı tekrar / kendini tekrar tanıtma | Bellek kullanılmıyor | Prompt + history | 🟠 |
| T4 | Düşünme boşluğunda ölü sessizlik | Latency maskeleme yok | Dolgu sesi | 🟠 |
| T5 | Öfkeye aynı tonla devam | Sabit TTS ayarı | Durum-bazlı TTS | 🟠 |
| T6 | "hı hı"yı tur sayıp araya girmek | Backchannel bağlı değil | Orchestrator | 🟠 |
| T7 | STT belirsizken tahmin edip yanlış tutar | Onarım yok | Prompt + confidence | 🟡 |
| T8 | Müşterinin kelimesini yankılamama | Recipient design yok | Prompt | 🟡 |

> Envanter canlı: her yeni gerçek arama dinlemesinden çıkan tell buraya eklenir.

---

## 3. SONRA ekleyeceklerimiz (ileri / uzun ufuk)

Bunlar daha çok mühendislik, veri veya Faz 2/3 olgunluğu ister. Şimdi değil ama
yol haritasında dursun:

- **Dinamik prozodi/SSML motoru.**
  - [x] **Teslimat duraklaması (yapıldı):** `paceForDelivery` para/tarih/yüzde
    figürlerinin ardına doğal duraklama (virgül) koyar → dinleyen yazabilsin;
    `normalizeForTTS`'ten önce çalışır. (Yan ürün: virgülsüz binlik "1.250"
    para ayrıştırma hatası da düzeltildi.)
  - [ ] **Tam SSML motoru (sonra):** içeriğe göre `<break time>`, emphasis, rate;
    vurguyu (focus) tutara/tarihe koyan işaretleme. Model/8kHz desteği doğrulanmalı.
- **Kapalı-döngü duygu uyarlaması.**
  - [x] **Metin-tabanlı katman (yapıldı):** `detectAffect` + `applyAffectTone` —
    öfkede de-eskalasyon (sakin/sabit, bekletme yok), zorlukta empati. anger > hardship.
  - [x] **Uçtan uca tesisat (yapıldı):** `STTEvent.final.affectHint` kanalı açık;
    orchestrator akustik sinyali metne TERCİH eder.
  - [ ] **Sağlayıcı sinyali (sonra):** STT'nin sesin KENDİSİNDEN öfke/stres üretmesi
    (Deepgram bugün vermiyor); geldiğinde tek satırla devreye girer.
- **Cross-call memory / kişiselleştirme.**
  - [x] **Ses tarafı (yapıldı):** `CallContext.priorCall` + prompt'a doğal "hatırlama"
    notu (`buildRecallNote`); WRONG_NUMBER'da hatırlatma yok (KVKK). İkinci aramada
    "geçen görüşmemizde ... demiştiniz" gibi doğal değinme.
  - [ ] **Veri tarafı (sonra):** API'nin borçlunun son tamamlanmış aramasından
    `priorCall`'u doldurması (DB sorgusu — Prisma gerektirir).
- **Gelişmiş turn-taking modeli.**
  - [x] **Barge-in inceltme (yapıldı):** `isLikelyBargeIn` — partial'da körü körüne
    kesme yok; boş/gürültü/backchannel'da AI susmaz (yanlış-pozitif kesme önlenir).
  - [ ] **Predictive endpointing / overlap (sonra):** gerçek ses akışı (Faz 2) gerektirir.
- **Comfort noise / ortam uyarlaması.** Tam dijital sessizlik "hat düştü mü"
  hissi verir; hafif doğal arka plan. Gürültülü müşteride yavaşla/tekrar teklif et.
- **Nefes & mikro-prozodi (v3 audio tags).** 8kHz'de dikkatli; nefes/duraklama
  doğallığı artırır ama bant sınırında abartı ters teper.
- **Diyalekt / bölgesel & kod-değiştirme uyumu.** Müşteri İngilizce kelime veya
  bölgesel ağız kullanınca doğal tepki.
- **A/B + otomatik kalibrasyon altyapısı.** Doğallık ayarlarını canlı aramalarda
  outcome'a (tahsilat/öfke) göre optimize eden deney sistemi — "kulağa hoş" değil ölçülen.
- **Speech-to-speech (Faz 3 — TR olgunlaşınca).** En düşük gecikme + en doğal
  prozodi; ama bugün Türkçe zayıf + lock-in (ARCHITECTURE.md §1). Gelecekte yeniden değerlendir.

---

## Notlar
- Faz 1'de (platform/Retell) prozodi/turn-taking'in bir kısmını platform yürütür;
  buradaki prompt + normalizasyon + tell envanteri yine SENDE kalır.
- Önerilen sıra: §1 hızlı kazanımlar → §1 algı sıçraması → §2 envanterden kalanlar
  → §3 ileri katman.
