/**
 * Llena las plantillas modernas con datos ficticios usando el renderizador real del CRM (functions/lib)
 * y comprueba que el texto generado sea idéntico al de las plantillas originales con los mismos datos.
 *
 * Uso: node scripts/contracts/moderno/render-muestras.cjs <carpeta-de-salida>
 */
const fs = require('fs');
const path = require('path');
const PizZip = require('../../../functions/node_modules/pizzip');
const { renderContract } = require('../../../functions/lib/modules/contracts/contractRenderer');
const { buildContractData } = require('../../../functions/lib/modules/contracts/contractData');
const { getProjectLegalProfile, SELLERS } = require('../../../functions/lib/modules/deals/legalProfiles');
const { buildSimpleRows } = require('../../../functions/lib/modules/deals/paymentPlan');

const outDir = path.resolve(process.argv[2] || path.join(__dirname, 'muestras'));
fs.mkdirSync(outDir, { recursive: true });

/** Texto del documento; la tabulación cuenta como espacio (el diseño la cambia en cuatro títulos) y no cuentan los espacios finales. */
const fullText = (buffer) => [...new PizZip(buffer).file('word/document.xml').asText().replace(/<w:tab\/>/g, '<w:t> </w:t>')
  .matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map((x) => x[1]).join('').trimEnd();

// El renderizador abre la plantilla por nombre: aquí se le entrega la copia moderna sin tocarlo.
const realRead = fs.readFileSync;
let useModern = false;
fs.readFileSync = (file, ...rest) => {
  const name = String(file);
  if (useModern && /[\\/]templates[\\/](preventa|promesa)-2026\.docx$/.test(name)) {
    return realRead(name.replace(/\.docx$/, '-moderno.docx'), ...rest);
  }
  return realRead(file, ...rest);
};

const buyer = (n, extra = {}) => ({
  id: `CC-100000000${n}`, companyId: 'c', personKind: 'natural', firstNames: n === 1 ? 'Carlos Andrés' : 'María Fernanda',
  lastNames: n === 1 ? 'Prueba Uno' : 'Ejemplo Dos', birthDate: '1991-04-10', maritalStatus: 'casado', gender: 'masculino',
  residenceCity: 'Bogotá D.C.', address: 'Calle 123 # 45 - 67', identificationKind: 'CC', identificationNumber: `100000000${n}`,
  expeditionCity: 'Bogotá D.C.', expeditionDate: '2009-11-03', mobile: `+57300111223${n}`, email: `comprador${n}@meraki.test`,
  leadIds: [], createdAt: null, updatedAt: null, ...extra,
});

function dataFor(projectId, buyers, separationCount) {
  const separationPayments = Array.from({ length: separationCount }, (_, i) => ({
    amount: 6_000_000 / separationCount, date: `2026-1${i}-27`,
  }));
  const simple = {
    separationTotal: 6_000_000, separationCount, separationFirstDate: '2026-10-27', separationPayments,
    ordinaryCount: 30, ordinaryFirstDate: '2026-12-27',
    extraordinary: [
      { amount: 5_000_000, date: '2027-01-01' }, { amount: 5_000_000, date: '2027-06-07' },
      { amount: 5_000_000, date: '2028-01-01' }, { amount: 5_000_000, date: '2029-01-01' },
    ],
  };
  const lot = {
    projectId, sector: 'COLORADO', lotNumber: '13', lotCode: '110013', inventoryLotId: `${projectId}-COLORADO-13`, areaM2: 375, corner: true,
  };
  const plan = {
    lotId: lot.inventoryLotId, mode: 'simple', simple, landValue: 139_751_192, termMonths: 30, benefit: 45_000_000,
    severance: { fundName: 'Fondo Nacional del Ahorro', amount: 3_000_000 },
    rows: buildSimpleRows(simple, { landValue: 139_751_192, benefit: 45_000_000, severance: 3_000_000 }),
    referredBy: 'N/A', notes: 'Se obsequian planos tipo y linderos.',
  };
  const profile = getProjectLegalProfile(projectId);
  return buildContractData({
    buyers, lot, plan, profile, seller: SELLERS[profile.seller], advisorName: 'Asesor Pruebas',
    issuedAt: { date: '2026-10-27', time: '09:15:00 AM' },
  });
}

const projects = process.env.PROYECTOS ? process.env.PROYECTOS.split(',') : ['laguna-mar', 'canon-arizona', 'rio-claro', 'llano-grande', 'sobre-montanas'];
const failures = [];
for (const projectId of projects) {
  for (const buyers of [[buyer(1)], [buyer(1), buyer(2)]]) {
    for (const kind of ['preventa', 'promesa']) {
      for (const separationCount of [1, 3]) {
        const label = `${kind}-${projectId}-${buyers.length}c-${separationCount}s`;
        try {
          const data = dataFor(projectId, buyers, separationCount);
          useModern = false;
          const original = renderContract(kind, data);
          useModern = true;
          const modern = renderContract(kind, data);
          useModern = false;
          const same = fullText(original) === fullText(modern);
          if (!same) failures.push(`${label}: el texto difiere`);
          console.log(`${same ? '✔' : '✘'} ${label} (${fullText(modern).length} caracteres)`);
          if (buyers.length === 2 && separationCount === 3 && projectId === projects[0]) {
            fs.writeFileSync(path.join(outDir, `${kind}-moderno-muestra.docx`), modern);
            fs.writeFileSync(path.join(outDir, `${kind}-original-muestra.docx`), original);
          }
        } catch (error) {
          failures.push(`${label}: ${error.message}`);
          console.log(`✘ ${label}: ${error.message}`);
        }
      }
    }
  }
}
if (failures.length) {
  console.error(`\n${failures.length} fallas`);
  process.exit(1);
}
console.log('\nTodas las combinaciones generan el mismo texto que las plantillas originales.');
