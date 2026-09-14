/**
 * SOLO LECTURA (Meta Marketing API). Encuentra a qué número de WhatsApp
 * apuntan los anuncios de "Clic a WhatsApp" (CTWA), para detectar cuáles
 * están dirigidos al número equivocado (SmartHome +57 300 3847735) en vez
 * del CRM (+57 317 682 0728).
 *
 * Uso:
 *   META_ADS_ACCESS_TOKEN=EAAxxx META_AD_ACCOUNT_ID=123456789 \
 *     node scripts/find-ctwa-destination.cjs
 *
 * (o pasa el token y la cuenta como argumentos):
 *   node scripts/find-ctwa-destination.cjs <TOKEN> <AD_ACCOUNT_ID>
 *
 * No escribe nada. No expone el token.
 */

const TOKEN   = process.argv[2] || process.env.META_ADS_ACCESS_TOKEN || '';
const ACCOUNT = (process.argv[3] || process.env.META_AD_ACCOUNT_ID || '').replace(/^act_/, '');
const VERSION = process.env.META_GRAPH_VERSION || 'v21.0';

// Números que nos importan (sin +, varias formas).
const BAD  = ['573003847735', '3003847735', '3847735'];   // SmartHome (equivocado)
const GOOD = ['573176820728', '3176820728', '3176820728']; // CRM Ventas 317 (correcto)

// IDs de anuncio ya vistos entrando a SmartHome (para lookup directo).
const KNOWN_LEAKING = ['120240405468820288', '120253715551110288'];

if (!TOKEN || !ACCOUNT) {
  console.error('Falta META_ADS_ACCESS_TOKEN y/o META_AD_ACCOUNT_ID.');
  console.error('Ej: META_ADS_ACCESS_TOKEN=EAAxxx META_AD_ACCOUNT_ID=123 node scripts/find-ctwa-destination.cjs');
  process.exit(1);
}

const g = async (path, params) => {
  const qs = new URLSearchParams({ ...params, access_token: TOKEN }).toString();
  const res = await fetch(`https://graph.facebook.com/${VERSION}/${path}?${qs}`);
  const body = await res.json();
  if (body.error) throw new Error(`${body.error.code} ${body.error.message}`);
  return body;
};

// Busca cualquiera de los números dentro del JSON crudo del creative.
const findNumbers = (obj, list) => {
  const s = JSON.stringify(obj || {});
  return list.filter((n) => s.includes(n));
};

const CREATIVE_FIELDS =
  'creative{object_story_spec,asset_feed_spec,effective_object_story_id,object_type,url_tags}';

(async () => {
  console.log(`\nCuenta act_${ACCOUNT} · Graph ${VERSION}\n`);

  // 1) Lookup directo de los anuncios ya detectados en SmartHome.
  console.log('=== Anuncios ya vistos entrando a SmartHome (+300) ===\n');
  for (const id of KNOWN_LEAKING) {
    try {
      const ad = await g(id, {
        fields: `name,effective_status,campaign{name},adset{name},${CREATIVE_FIELDS}`,
      });
      const bad  = findNumbers(ad.creative, BAD);
      const good = findNumbers(ad.creative, GOOD);
      console.log(`• ${id}`);
      console.log(`    Campaña : ${ad.campaign?.name ?? '—'}`);
      console.log(`    Conjunto: ${ad.adset?.name ?? '—'}`);
      console.log(`    Anuncio : ${ad.name ?? '—'}  [${ad.effective_status ?? '—'}]`);
      console.log(`    Número  : ${bad.length ? '❌ +300 (SmartHome) ' + bad.join(',') : good.length ? '✅ 317 (CRM)' : '⚠ no visible en el creative (ver Ads Manager)'}`);
      console.log('');
    } catch (e) {
      console.log(`• ${id} → no accesible con este token/cuenta: ${e.message}\n`);
    }
  }

  // 2) Escaneo de TODOS los anuncios activos de la cuenta.
  console.log('=== Escaneo de anuncios ACTIVOS de la cuenta ===\n');
  let url = `act_${ACCOUNT}/ads`;
  let params = {
    fields: `name,effective_status,campaign{name},adset{name},${CREATIVE_FIELDS}`,
    effective_status: JSON.stringify(['ACTIVE']),
    limit: '200',
  };
  const leaking = [];
  const ok = [];
  const unknown = [];
  let pages = 0;

  while (url && pages < 25) {
    const body = await g(url, params);
    for (const ad of body.data ?? []) {
      const bad  = findNumbers(ad.creative, BAD);
      const good = findNumbers(ad.creative, GOOD);
      const row = { id: ad.id, name: ad.name, campaign: ad.campaign?.name, adset: ad.adset?.name };
      if (bad.length) leaking.push({ ...row, num: bad.join(',') });
      else if (good.length) ok.push(row);
      else unknown.push(row);
    }
    // paginación
    const next = body.paging?.next;
    if (next) { url = next.replace(`https://graph.facebook.com/${VERSION}/`, '').split('?')[0]; params = Object.fromEntries(new URL(next).searchParams); }
    else url = null;
    pages++;
  }

  const line = (r) => `    - ${r.campaign ?? '—'}  ›  ${r.adset ?? '—'}  ›  ${r.name ?? '—'}  (${r.id})${r.num ? '  [' + r.num + ']' : ''}`;

  console.log(`❌ APUNTAN AL +300 (SmartHome) — ${leaking.length}:`);
  leaking.forEach((r) => console.log(line(r)));
  console.log(`\n✅ Apuntan al 317 (CRM) — ${ok.length}:`);
  ok.forEach((r) => console.log(line(r)));
  console.log(`\n⚠ Número no visible en el creative (revisar manualmente en Ads Manager) — ${unknown.length}:`);
  unknown.forEach((r) => console.log(line(r)));
  console.log('');
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
