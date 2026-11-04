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

Při každé nové verzi změň v `sw.js` číslo v `CACHE = 'narez-plechu-v2'`, ať se lidem aktualizace hned stáhne.

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
```

## Poznámky k přesnosti

- Obdélníky se skládají přesně na desetinu milimetru.
- Tvarové díly se skládají v mřížce s krokem podle velikosti plechu (obvykle 2,5–5 mm). Díl má proto
  kolem sebe nejvýš jeden krok mřížky navíc, ale díly se nikdy nepřekryjí.
- Plášť kužele se počítá bez přídavku na spoj. Přídavek přičti k průměru.
