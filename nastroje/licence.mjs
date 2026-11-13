// Generátor licenčních klíčů pro Nářez plechu.
//
// Soukromý klíč NIKDY nesmí do repozitáře (repo je veřejné). Ukládá se mimo něj,
// do složky ../SIKULA-licence vedle projektu. Kdo ho má, může vyrábět platné licence.
// O složku nepřijď – bez soukromého klíče už nové licence nevydáš (dá se jen vyrobit nový
// a vydat všem nové klíče). OneDrive ji zálohuje, ale udělej si i kopii jinam.
//
// Použití (v příkazovém řádku ve složce SIKULA):
//   node nastroje/licence.mjs init                         jednou: vyrobí pár klíčů
//   node nastroje/licence.mjs "Klempířství Novák" 2027-12-31
//   node nastroje/licence.mjs "Klempířství Novák"            platnost rok od dneška
//   node nastroje/licence.mjs seznam                       vydané licence
//
// Výstup: licenční klíč a odkaz, kterým se licence v aplikaci rovnou aktivuje.
import { generateKeyPairSync, createPrivateKey, sign } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_URL = 'https://frenkoff30.github.io/sikulka/';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = resolve(ROOT, '..', 'SIKULA-licence');
const PRIV = join(DIR, 'soukromy-klic.json');
const LOG = join(DIR, 'vydane-licence.csv');

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const die = (m) => { console.error('\n  ' + m + '\n'); process.exit(1); };
const [cmd, arg2] = process.argv.slice(2);

if (!cmd) die('Zadej název firmy, např.:  node nastroje/licence.mjs "Klempířství Novák" 2027-12-31');

if (cmd === 'init') {
  if (existsSync(PRIV)) die(`Klíč už existuje: ${PRIV}\n  Nový bych nevyráběl – všechny vydané licence by přestaly platit.`);
  mkdirSync(DIR, { recursive: true });
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  writeFileSync(PRIV, JSON.stringify(privateKey.export({ format: 'jwk' }), null, 2));
  writeFileSync(LOG, 'cislo;firma;plati_do;vydano;klic\n');
  const { x, y } = publicKey.export({ format: 'jwk' });
  console.log(`\n  Soukromý klíč uložen: ${PRIV}\n\n  Veřejný klíč vlož do js/licence.js (PUBLIC_KEY):\n  { kty: 'EC', crv: 'P-256', x: '${x}', y: '${y}' }\n`);
  process.exit(0);
}

if (!existsSync(PRIV)) die(`Chybí soukromý klíč ${PRIV}. Nejdřív spusť:  node nastroje/licence.mjs init`);

if (cmd === 'seznam') { console.log(readFileSync(LOG, 'utf8')); process.exit(0); }

const firm = cmd.trim();
if (firm.length < 2 || firm.length > 80) die('Název firmy musí mít 2 až 80 znaků.');
const today = new Date();
const iso = (d) => d.toISOString().slice(0, 10);
let exp = arg2;
if (!exp) { const d = new Date(today); d.setFullYear(d.getFullYear() + 1); exp = iso(d); }
if (!/^\d{4}-\d{2}-\d{2}$/.test(exp) || isNaN(Date.parse(exp))) die('Datum zadej jako RRRR-MM-DD, např. 2027-12-31.');

const n = readFileSync(LOG, 'utf8').trim().split('\n').length;  // hlavička + vydané
const payload = { n: String(n).padStart(4, '0'), f: firm, e: exp, i: iso(today) };
const data = Buffer.from(JSON.stringify(payload), 'utf8');
const key = createPrivateKey({ key: JSON.parse(readFileSync(PRIV, 'utf8')), format: 'jwk' });
const sig = sign('sha256', data, { key, dsaEncoding: 'ieee-p1363' });
const lic = `NP1.${b64u(data)}.${b64u(sig)}`;
appendFileSync(LOG, `${payload.n};${firm.replace(/;/g, ',')};${exp};${payload.i};${lic}\n`);

console.log(`
  Licence č. ${payload.n} pro „${firm}“, platí do ${exp}

  Klíč (zákazník ho vloží v aplikaci: tlačítko Aplikace → Licence):
  ${lic}

  Nebo odkaz, který licenci aktivuje rovnou (na iPhonu otevřít v nainstalované aplikaci nejde,
  tam je potřeba klíč vložit):
  ${APP_URL}#licence=${lic}
`);
