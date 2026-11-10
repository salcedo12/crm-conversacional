/**
 * Datos de prueba para los EMULADORES locales (proyecto demo-crm-local).
 * Nunca toca Firebase real: se niega a correr si no apunta a los emuladores.
 *
 *   1. scripts\start-emulators.cmd
 *   2. node scripts/seed-emulator.cjs   (CRM + inventario de disponibilidad simulado)
 *   3. cd frontend-v2 && npm run dev:local   → http://localhost:5175
 *
 * Usuarios de prueba (solo existen en el emulador):
 *   admin.pruebas@meraki.test   / Meraki-Local-2026   (admin)
 *   asesor.pruebas@meraki.test  / Meraki-Local-2026   (asesor, con 3 leads asignados)
 */

process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= '127.0.0.1:9099';

const path = require('path');
const admin = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'));

const PROJECT_ID = 'demo-crm-local';
const COMPANY_ID = 'grupo_meraki_real';
const PASSWORD = 'Meraki-Local-2026';

if (!PROJECT_ID.startsWith('demo-')) throw new Error('Solo se permite un proyecto demo-');

admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();
const auth = admin.auth();
const { Timestamp } = admin.firestore;

// Inventario de disponibilidad (tour-meraki) simulado: otro proyecto dentro del mismo
// emulador, con el formato real (inventario + proyectos_resumen). Datos ficticios.
const INVENTORY_PROJECT_ID = 'demo-disponibilidad';
const inventoryDb = admin.initializeApp({ projectId: INVENTORY_PROJECT_ID }, 'inventory').firestore();
const INVENTORY = [
  { proyecto: 'laguna-mar', sector: 'MAR CANARIAS', lots: 40, codePrefix: 1100 },
  { proyecto: 'laguna-mar', sector: 'MAR SANTORINI', lots: 30, codePrefix: 1200 },
  { proyecto: 'rio-claro', sector: 'RIO LAGUNILLA', lots: 30, codePrefix: 6010 },
  { proyecto: 'rio-claro', sector: 'RIO MEDINA', lots: 20, codePrefix: 6020 },
  { proyecto: 'cañon-arizona', sector: 'TEXAS', lots: 25, codePrefix: 8040 },
  { proyecto: 'cañon-arizona', sector: 'COLORADO', lots: 25, codePrefix: 8010 },
];

const USERS = [
  { email: 'admin.pruebas@meraki.test', displayName: 'Admin Pruebas', role: 'admin' },
  { email: 'asesor.pruebas@meraki.test', displayName: 'Asesor Pruebas', role: 'advisor' },
  // "Solo lectura": ve todas las conversaciones sin poder modificar nada.
  { email: 'lectura.pruebas@meraki.test', displayName: 'Lectura Pruebas', role: 'viewer' },
];

const LEADS = [
  { id: 'lead-carlos', name: 'Carlos Andrés Prueba Uno', phone: '+573001112233', projectInterest: ['Laguna Mar'] },
  { id: 'lead-ana', name: 'Ana María Prueba Dos', phone: '+573004445566', projectInterest: ['Río Claro'] },
  { id: 'lead-pedro', name: 'Pedro Prueba Tres', phone: '+573007778899', projectInterest: ['Cañón de Arizona'] },
];

async function upsertUser({ email, displayName, role }) {
  let user;
  try {
    user = await auth.getUserByEmail(email);
  } catch {
    user = await auth.createUser({ email, password: PASSWORD, displayName, emailVerified: true });
  }
  await auth.setCustomUserClaims(user.uid, { companyId: COMPANY_ID, role, active: true, platformAdmin: false });
  const now = Timestamp.now();
  await db.doc(`companies/${COMPANY_ID}/users/${user.uid}`).set({
    companyId: COMPANY_ID, email, displayName, role, active: true, receiveLeads: true, createdAt: now, updatedAt: now,
  }, { merge: true });
  return user.uid;
}

async function main() {
  const now = Timestamp.now();
  await db.doc(`companies/${COMPANY_ID}`).set({ name: 'Grupo Meraki (pruebas locales)', createdAt: now }, { merge: true });

  const uids = {};
  for (const u of USERS) uids[u.role] = await upsertUser(u);

  for (const [i, lead] of LEADS.entries()) {
    const at = Timestamp.fromMillis(Date.now() - i * 3600_000);
    await db.doc(`companies/${COMPANY_ID}/leads/${lead.id}`).set({
      companyId: COMPANY_ID,
      name: lead.name,
      phone: lead.phone,
      normalizedPhone: lead.phone.toLowerCase(),
      phoneTail: lead.phone.slice(-10),
      status: 'qualified',
      source: 'whatsapp',
      inbox: 'central_317',
      projectInterest: lead.projectInterest,
      assignedTo: uids.advisor,
      aiEnabled: false,
      metadata: {},
      tags: [],
      createdAt: at,
      updatedAt: at,
      lastMessageAt: at,
    }, { merge: true });
  }

  const summaries = {};
  let lotCount = 0;
  for (const group of INVENTORY) {
    for (let n = 1; n <= group.lots; n++) {
      const id = `${group.proyecto}-${group.sector.replace(/\s+/g, '')}-${n}`;
      // Mezcla de estados como en la vida real: vendidos, en negociación y disponibles.
      const status = n % 4 === 0 ? 'VENDIDO' : n % 7 === 0 ? 'NEGOCIACION' : 'DISPONIBLE';
      const area = 300 + (n % 5) * 25 + (n % 3 === 0 ? 0.6 : 0);
      const code = String(group.codePrefix * 100 + n);
      const lot = {
        proyecto: group.proyecto, sector: group.sector,
        numeroTerreno: String(n), lote: String(n), code, codigo: code,
        areaM2: area, area, esquinero: n % 6 === 1, status,
        observaciones: '', fechaSeparacion: '', fechaVencimiento: '', updatedAt: new Date().toISOString(),
      };
      await inventoryDb.doc(`inventario/${id}`).set(lot);
      (summaries[group.proyecto] ??= {})[id] = {
        s: status, a: area, n: String(n), sec: group.sector, c: code, e: lot.esquinero, o: '', f: '', x: '',
      };
      lotCount++;
    }
  }
  for (const [projectId, lots] of Object.entries(summaries)) {
    await inventoryDb.doc(`proyectos_resumen/${projectId}`).set({ lots, lastUpdated: new Date().toISOString() });
  }

  console.log(`Listo: empresa ${COMPANY_ID}, ${USERS.length} usuarios y ${LEADS.length} leads en el emulador.`);
  console.log(`Inventario ${INVENTORY_PROJECT_ID}: ${lotCount} lotes en ${Object.keys(summaries).length} proyectos.`);
}

main().catch((err) => { console.error(err); process.exit(1); });
