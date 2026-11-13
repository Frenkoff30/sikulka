// Licence: beta zdarma, potom roční licence. Bez licence jede aplikace jako demo.
//
// Klíč je digitálně podepsaný (ECDSA P-256) soukromým klíčem, který je jen u autora
// (generátor: nastroje/licence.mjs). Aplikace ho ověří veřejným klíčem níže, bez serveru
// a bez internetu. Formát: NP1.<údaje base64url>.<podpis base64url>
// Údaje: { n: číslo licence, f: firma, e: platí do (RRRR-MM-DD), i: vydáno }

export const CONFIG = {
  VERSION: '1.0 beta',
  BETA_END: '2027-01-31',          // do tohoto dne (včetně) je všechno zdarma
  PRICE: 499,                      // Kč za rok
  BUY_URL: 'https://www.webostudio.cz/?typ=system#kontakt',
  WEB_URL: 'https://www.webostudio.cz/portfolio/optimalizace-narezu',
  MAIL: 'webostudio@seznam.cz',
  DEMO_JOBS: 3,                    // demo: nejvýš tolik uložených zakázek
  DEMO_STOCK: 3,                   // demo: nejvýš tolik položek ve skladu zbytků
  WARN_DAYS: 30,                   // kolik dní před koncem licence připomínat prodloužení
};

const PUBLIC_KEY = { kty: 'EC', crv: 'P-256', x: 'bjJLeCk_xJE33O9cNgInchhA0JsVJjvijZdz_rRuAjo', y: '-9gE-xUsqDYcbICf7aiB4xG9CgFO0c7Hs3o2JVcSEMA' };

export const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
export const czDate = (iso) => { const [y, m, d] = iso.split('-').map(Number); return `${d}. ${m}. ${y}`; };
const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
const unb64 = (s) => { const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)); return Uint8Array.from(b, (c) => c.charCodeAt(0)); };

/** Vytáhne klíč z textu – i z celého vloženého odkazu nebo e-mailu zalomeného na víc řádků. */
export function cleanKey(text) {
  const s = String(text || '').replace(/\s+/g, '');
  const m = s.match(/NP1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
  return m ? m[0] : s;
}

/** Ověří klíč. Vrací { ok: true, n, f, e, i, key } nebo { ok: false, err }. */
export async function verifyKey(text) {
  const key = cleanKey(text);
  const parts = key.split('.');
  if (parts.length !== 3 || parts[0] !== 'NP1') return { ok: false, err: 'Tohle nevypadá jako licenční klíč. Začíná „NP1.“.' };
  if (!globalThis.crypto?.subtle) return { ok: false, err: 'Klíč tady nejde ověřit – aplikace musí běžet přes zabezpečenou adresu https.' };
  try {
    const data = unb64(parts[1]), sig = unb64(parts[2]);
    const pk = await crypto.subtle.importKey('jwk', PUBLIC_KEY, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const good = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pk, sig, data);
    if (!good) return { ok: false, err: 'Klíč není platný. Zkontroluj, že je zkopírovaný celý.' };
    const p = JSON.parse(new TextDecoder().decode(data));
    if (!p.f || !/^\d{4}-\d{2}-\d{2}$/.test(p.e)) return { ok: false, err: 'Klíč je poškozený.' };
    return { ok: true, n: p.n, f: p.f, e: p.e, i: p.i, key };
  } catch {
    return { ok: false, err: 'Klíč není platný. Zkontroluj, že je zkopírovaný celý.' };
  }
}

/**
 * Stav aplikace podle licence a data.
 * mode: 'full' (platná licence) | 'beta' (zdarma do konce bety) | 'demo' (omezená verze)
 */
export function status(lic) {
  const t = today();
  if (lic?.ok && t <= lic.e) return { mode: 'full', lic, left: days(t, lic.e) };
  if (t <= CONFIG.BETA_END) return { mode: 'beta', lic, left: days(t, CONFIG.BETA_END), expired: !!lic?.ok };
  return { mode: 'demo', lic, expired: !!lic?.ok };
}
