/**
 * Registrar una LÍNEA DE ASESOR en coexistencia (YCloud).
 *
 * Marca un número de negocio como línea personal de un asesor conectada por
 * COEXISTENCIA (WhatsApp Business App + Cloud API en el mismo número). A partir
 * de ahí, los leads que entran DIRECTO a esa línea:
 *   - se crean con source `advisor_whatsapp` (fuera de stats y del reparto),
 *   - se asignan SOLO a ese asesor (solo él los ve),
 *   - la IA no responde (él chatea desde su celular),
 * y los envíos del CRM a esos leads (plantillas/videos/masivos) salen por SU
 * número, no por el 317. Los leads que YA existían (entraron por el 317)
 * conservan su fuente/etiquetas.
 *
 * Uso:
 *   node functions/scripts/register-advisor-line.cjs \
 *     --number +573001234567 --advisor <uidDelAsesor> --waba <wabaIdDeSuLinea> \
 *     [--company grupo_meraki_real] [--label "WhatsApp Laura"]
 *
 *   El --waba es el WABA ID que YCloud muestra para SU número (suele ser distinto
 *   al del 317). Necesario para poder listar/enviar SUS plantillas.
 *
 *   # Desactivar (volver a tratar sus mensajes como normales):
 *   node functions/scripts/register-advisor-line.cjs --number +573001234567 --disable
 *
 * Requiere service-account.json en la raíz del repo.
 */
process.env.GOOGLE_APPLICATION_CREDENTIALS = process.env.GOOGLE_APPLICATION_CREDENTIALS || 'C:/crm-conversacional/service-account.json';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'crm-conversacional';
const admin = require('C:/crm-conversacional/functions/node_modules/firebase-admin');
if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(require('C:/crm-conversacional/service-account.json')), projectId: 'crm-conversacional' });
}
const db = admin.firestore();

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}

// Mismo id que companyRouting.channelRouteId('ycloud', <solo dígitos>).
function routeId(number) {
  const digits = String(number).replace(/[^\d]/g, '');
  return `ycloud_${digits.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
}

async function main() {
  const number   = arg('number');
  const disable  = arg('disable', false);
  const advisor  = arg('advisor');
  const company  = arg('company', 'grupo_meraki_real');
  const label    = arg('label', '');
  const waba     = arg('waba', '');

  if (!number || typeof number !== 'string') {
    console.error('Falta --number (ej: +573001234567).');
    process.exit(1);
  }
  const digits = number.replace(/[^\d]/g, '');
  if (digits.length < 8) { console.error('Número inválido.'); process.exit(1); }

  const id = routeId(number);
  const ref = db.collection('channelRoutes').doc(id);
  const now = admin.firestore.Timestamp.now();

  if (disable) {
    await ref.set({ active: false, updatedAt: now }, { merge: true });
    console.log(`✔ Línea ${number} DESACTIVADA como línea de asesor (${id}).`);
    return;
  }

  if (!advisor || typeof advisor !== 'string') {
    console.error('Falta --advisor <uid del asesor>. Míralo en companies/<company>/users.');
    process.exit(1);
  }

  // Validación: el asesor debe existir y estar activo en la empresa.
  const userSnap = await db.collection('companies').doc(company).collection('users').doc(advisor).get();
  if (!userSnap.exists) {
    console.error(`El asesor ${advisor} no existe en companies/${company}/users.`);
    process.exit(1);
  }
  if (userSnap.data()?.active === false) {
    console.error(`El asesor ${advisor} está inactivo.`);
    process.exit(1);
  }

  const exists = (await ref.get()).exists;
  await ref.set({
    provider:   'ycloud',
    identifier: digits,
    companyId:  company,
    kind:       'advisor_coexistence',
    advisorId:  advisor,
    ...(waba && typeof waba === 'string' ? { wabaId: waba } : {}),
    label:      label || `WhatsApp asesor (${userSnap.data()?.displayName || advisor})`,
    active:     true,
    updatedAt:  now,
    ...(exists ? {} : { createdAt: now }),
  }, { merge: true });

  console.log(`✔ Línea ${number} registrada como línea de asesor de "${userSnap.data()?.displayName || advisor}".`);
  console.log(`  Doc: channelRoutes/${id}  ·  empresa: ${company}${waba ? `  ·  WABA: ${waba}` : ''}`);
  console.log('  Los nuevos leads de esta línea entrarán como advisor_whatsapp (solo suyos, fuera de stats/reparto).');
  if (!waba) console.log('  ⚠ Sin --waba: sus plantillas NO se sincronizarán hasta agregar el WABA ID de su línea.');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
