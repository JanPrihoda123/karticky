# Návod: Kartičky na iPhonu s notifikacemi

Celé nastavení má tři části: **GitHub Pages** (kde aplikace běží), **Cloudflare Worker** (posílá připomínky) a **instalaci na iPhone**. Všechno je zdarma.

## 1. GitHub Pages

1. Na <https://github.com/new> vytvořte repozitář s názvem `karticky`, zvolte **Public**, nic dalšího nezaškrtávejte a klikněte **Create repository**.
2. Nahrajte do něj kód (`git push`, viz níže).
3. V repozitáři otevřete **Settings → Pages**. U *Source* zvolte **Deploy from a branch**, větev **main**, složka **/ (root)**, a uložte.
4. Za minutu dvě aplikace poběží na `https://<vaše-jméno>.github.io/karticky/`.

## 2. Cloudflare Worker (server pro notifikace)

1. Zaregistrujte se na <https://dash.cloudflare.com/sign-up>.
2. **Workers & Pages → Create → Create Worker** (šablona *Hello World*), pojmenujte ho `karticky-push` a klikněte **Deploy**.
3. Klikněte **Edit code**, smažte vzorový kód, vložte celý obsah souboru `worker/push-worker.js` a klikněte **Deploy**.
4. **Storage & Databases → KV → Create** a vytvořte úložiště `karticky-subs`.
5. Ve workeru otevřete **Settings → Bindings → Add → KV namespace**. *Variable name* je `SUBS`, úložiště `karticky-subs`.
6. Ve **Settings → Variables and Secrets → Add** přidejte proměnnou typu *Text* s názvem `ALLOWED_ORIGIN` a hodnotou `https://<vaše-jméno>.github.io` (bez lomítka a bez `/karticky`).
7. Ve **Settings → Trigger Events → Add → Cron Triggers** zadejte `*/15 * * * *` (worker se spustí každých 15 minut).
8. Zkopírujte adresu workeru, třeba `https://karticky-push.<něco>.workers.dev`, a vložte ji do `js/config.js` jako `PUSH_SERVER_URL`. Pak změnu znovu nahrajte na GitHub.

Kontrola: po otevření adresy workeru v prohlížeči se má zobrazit text „Kartičky push server OK“.

## 3. Instalace na iPhone (iOS 16.4 nebo novější)

1. V **Safari** otevřete `https://<vaše-jméno>.github.io/karticky/`.
2. Klepněte na **Sdílet** (čtvereček se šipkou) → **Přidat na plochu** → **Přidat**.
3. Otevřete Kartičky **z ikony na ploše** (ne ze Safari).
4. Na přehledu sjeďte k **Připomínkám**, vyberte čas a klepněte **Zapnout připomínky** → **Povolit**.
5. Klepněte **Poslat zkušební notifikaci**. Do pár sekund by měla dorazit.

## Dobré vědět

- Karty se ukládají jen v telefonu, v nainstalované aplikaci. Karty vytvořené na počítači se do telefonu samy nepřenesou. Přenést je můžete přes **Stáhnout zálohu** a **Obnovit ze zálohy** (soubor pošlete např. přes AirDrop nebo iCloud Drive).
- Připomínka přijde jednou denně ve zvolený čas, ale **jen pokud máte co opakovat**. Pokud to stihnete dřív, nepřijde.
- Když na iPhonu smažete ikonu aplikace, smažou se i karty. Dělejte si zálohy.
- Na server se posílají jen data, kdy jsou karty k opakování, a časové pásmo. Fotky z telefonu nikam neodcházejí.
