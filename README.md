# Nářez plechu

Aplikace pro klempíře a plecháře. Zadáš rozměr plechu (tabule nebo svitek) a díly, které potřebuješ.
Aplikace je poskládá tak, aby zbylo co nejméně odpadu, a nakreslí výkres.

Funguje na **počítači i na mobilu**, dá se **nainstalovat jako aplikace** a pak jede i **bez internetu**.

## Co umí

- **Libovolný rozměr plechu**: tabule (šířka × délka) nebo svitek, kde spočítá, kolik metrů odvinout.
- **Díly libovolného tvaru**: obdélník, šikmý konec, lichoběžník, trojúhelník, pravoúhlý trojúhelník,
  kosodélník, L-tvar, kruh, kroužek, kruhová výseč, **plášť kužele** (rozvin se spočítá sám)
  a **vlastní tvar**, který se nakreslí prstem nebo myší, nebo zadá přesně délkou a směrem stran.
- **Automatické skládání**: zkouší stovky variant a otáčení po 90°, malé díly zastrčí do výřezů a děr.
- **Tabulové nůžky**: když jsou všechny díly obdélníky, dodrží střih vždy přes celý kus a vypíše
  **postup střihu krok za krokem**.
- **Ruční skládání**: díly se dají na plechu chytit a posunout, otočit, odložit do zásobníku a zase vrátit.
  Díl se přichytí ke kraji, k sousedům i na střed a zčervená, když se překrývá.
- **Kde díly orýsovat**: u každého dílu vzdálenost od kraje a od hrany.
- **Zakázky**: uložení a otevření rozpracovaných zakázek.
- **Tisk / PDF** výkresů, světlý a tmavý režim.

## Jak to spustit ve VS Code

Aplikace se **nesmí otevírat dvojklikem** na `index.html`, protože prohlížeč pak z bezpečnostních důvodů
nenačte její části. Spusť ji přes malý server:

1. Ve VS Code otevři složku `SIKULA`.
2. Dole v liště klikni na **Go Live** (rozšíření Live Server).
3. Otevře se prohlížeč s aplikací na `http://127.0.0.1:5500`.

### Vyzkoušet na mobilu ve stejné Wi-Fi

1. Spusť Go Live na počítači.
2. Zjisti IP adresu počítače (v příkazovém řádku `ipconfig` → IPv4, např. `192.168.1.20`).
3. Na mobilu otevři `http://192.168.1.20:5500`.

Takhle se dá všechno vyzkoušet. **Instalace na plochu a offline režim** ale na mobilu fungují jen přes
zabezpečenou adresu `https://`, tedy až po zveřejnění na internetu (viz níže).

## Jak to dostat k lidem

Aplikace je jen sada souborů a nepotřebuje žádný vlastní server. Stačí ji nahrát na libovolný
statický hosting s `https`, třeba zdarma na **GitHub Pages**, **Netlify** nebo **Cloudflare Pages**.
Lidé pak otevřou odkaz a kliknou na „Nainstalovat“ (počítač, Android) nebo „Sdílet → Přidat na plochu“ (iPhone).

Při každé nové verzi zvyš v `sw.js` číslo v `CACHE = 'narez-plechu-v…'`, ať se lidem aktualizace hned stáhne.

## Licence (beta → placená verze)

Nastavení je v `js/licence.js` (`CONFIG`): konec bety, cena, limity dema, e-mail.

- **Do `BETA_END`** (31. 1. 2027) je všechno zdarma, nahoře je proužek „Beta“.
- **Potom bez licence** jede appka jako **demo**: nejvýš 3 uložené zakázky a 3 zbytky, tisk s nápisem DEMO.
  Starší zakázky a zbytky nikomu nezmizí, jen nejdou přidávat další.
- **S licencí** je všechno odemčené a ve výkresu je v patičce jméno firmy. Měsíc před koncem appka připomene prodloužení.

Licenční klíč je digitálně podepsaný. Aplikace ho ověří sama, bez serveru a bez internetu.

### Jak vydat licenci

```
node nastroje/licence.mjs "Klempířství Novák" 2027-12-31
```

Bez data platí rok od dneška. Vypíše klíč a odkaz, který licenci rovnou aktivuje. Pošli obojí zákazníkovi
(na iPhonu se klíč vkládá ručně: **Aplikace → Licence**). Přehled vydaných: `node nastroje/licence.mjs seznam`.

**Soukromý klíč** je ve složce `../SIKULA-licence` vedle projektu, **nikdy ne v repu**. Kdo ho má, vyrobí si licenci.
Když se ztratí, nové licence už nevydáš, tak si složku zálohuj i jinam než na OneDrive.

## Záloha dat

Zakázky a sklad jsou uložené jen v prohlížeči daného zařízení. V okně **Aplikace** jde uložit zálohu do souboru
a obnovit ji (i na jiném zařízení). Obnova nahradí zakázky a sklad, dá se vrátit tlačítkem v hlášce.

## Struktura projektu

```
index.html              stránka aplikace
manifest.webmanifest    údaje pro instalaci (název, ikony, barvy)
sw.js                   offline režim
css/app.css             vzhled (světlý i tmavý režim, mobil, tisk)
icons/                  ikony aplikace
js/app.js               hlavní logika: zadání, seznam dílů, výpočet, zakázky, instalace
js/shapes.js            tvary dílů (šablony) a geometrie
js/editor.js            okno pro přidání / úpravu dílu včetně kreslení
js/rect-engine.js       přesné skládání obdélníků a postup střihu nůžkami
js/nest-engine.js       skládání libovolných tvarů
js/nest-worker.js       počítání tvarů na pozadí, aby se aplikace nesekala
js/render.js            výkresy a souhrn
js/manual.js            ruční skládání
js/format.js            pomocné funkce (čísla, výrazy, formát)
js/licence.js           licence: ověření klíče, beta / demo / plná verze
nastroje/licence.mjs    generátor licenčních klíčů (spouští se v Node)
```

## Poznámky k přesnosti

- Obdélníky se skládají přesně na desetinu milimetru.
- Tvarové díly se skládají v mřížce s krokem podle velikosti plechu (obvykle 2,5–5 mm). Díl má proto
  kolem sebe nejvýš jeden krok mřížky navíc, ale díly se nikdy nepřekryjí.
- Plášť kužele se počítá bez přídavku na spoj. Přídavek přičti k průměru.
