import { createHash } from 'crypto';
import { fechaCorta, fechaEnLetras, formatDMY } from '../deals/civilDate';
import { formatoPesos, pesosEnLetras } from '../deals/numeroALetras';
import { computeEarnestMoney, groupInstallments, summarizePlan, type InstallmentGroup } from '../deals/paymentPlan';
import type { ProjectLegalProfile, SellerEntity } from '../deals/legalProfiles';
import type { ClientProfile, DealLot, PaymentPlan } from '../deals/deals.types';

/**
 * Datos con los que se llenan las plantillas Word (functions/templates/*.docx).
 * Las claves con punto ("plan.valorTerreno") son claves literales: así las busca
 * docxtemplater sin parser adicional. Dentro de {#compradores}…{/compradores}
 * se usan las claves de `BuyerFields`.
 */

const ID_LABEL: Record<string, string> = { CC: 'CÉDULA', CE: 'C.E.', NIT: 'NIT', PAS: 'PASAPORTE', PPT: 'PPT', TI: 'T.I.' };
const ID_LONG: Record<string, string> = {
  CC: 'CÉDULA DE CIUDADANÍA', CE: 'CÉDULA DE EXTRANJERÍA', NIT: 'NIT', PAS: 'PASAPORTE',
  PPT: 'PERMISO DE PROTECCIÓN TEMPORAL', TI: 'TARJETA DE IDENTIDAD',
};
const MARITAL: Record<string, string> = {
  // Como lo escribe SmartHome ("Casado(a)"): más corto y no se parte en las celdas angostas.
  soltero: 'Soltero(a)', casado: 'Casado(a)', union_libre: 'Unión libre', divorciado: 'Divorciado(a)', viudo: 'Viudo(a)', separado: 'Separado(a)',
};

export interface BuyerFields {
  nombreCompleto:       string;
  tipoPersona:          string;
  etiquetaId:           string;
  tipoIdLargo:          string;
  numeroId:             string;
  expedicion:           string;
  ciudadExpedicion:     string;
  fechaExpedicion:      string;
  estadoCivil:          string;
  celular:              string;
  celularInternacional: string;
  correo:               string;
  direccion:            string;
  ciudadResidencia:     string;
}

export function buyerFields(c: ClientProfile): BuyerFields {
  const ciudadExpedicion = c.expeditionCity.toUpperCase();
  return {
    nombreCompleto: `${c.firstNames} ${c.lastNames}`.replace(/\s+/g, ' ').trim().toUpperCase(),
    tipoPersona: c.personKind === 'juridica' ? 'PERSONA JURÍDICA' : 'PERSONA NATURAL',
    etiquetaId: ID_LABEL[c.identificationKind] ?? c.identificationKind,
    tipoIdLargo: ID_LONG[c.identificationKind] ?? c.identificationKind,
    numeroId: c.identificationNumber,
    expedicion: `${ciudadExpedicion} ${formatDMY(c.expeditionDate)}`,
    ciudadExpedicion,
    fechaExpedicion: formatDMY(c.expeditionDate),
    estadoCivil: c.maritalStatus ? MARITAL[c.maritalStatus] : 'NO APLICA',
    celular: c.mobile.replace(/^\+57/, ''),
    celularInternacional: c.mobile,
    correo: c.email,
    direccion: c.address,
    ciudadResidencia: c.residenceCity,
  };
}

/** "$ 5.635.500" con espacio no separable: en columnas angostas el $ no queda solo en otra línea. */
const pesos = (n: number) => formatoPesos(n).replace('$ ', '$\u00a0');

function groupDates(g: InstallmentGroup): string {
  return g.count > 1 ? `${formatDMY(g.from)} a ${formatDMY(g.to)}` : formatDMY(g.from);
}

export interface ContractInputs {
  buyers:       ClientProfile[];   // en orden (1 = titular)
  lot:          DealLot;
  plan:         PaymentPlan;
  profile:      ProjectLegalProfile;
  seller:       SellerEntity;
  advisorName:  string;
  /** Fecha y hora de emisión en Colombia. */
  issuedAt:     { date: string; time: string };   // 'YYYY-MM-DD', 'hh:mm:ss AM'
}

export type ContractData = Record<string, unknown>;

export function buildContractData(input: ContractInputs): ContractData {
  const { buyers, lot, plan, profile, seller } = input;
  if (!buyers.length) throw new Error('El negocio no tiene compradores.');
  const summary = summarizePlan(plan);
  const byKind = (k: 'separacion' | 'ordinaria' | 'extraordinaria') =>
    groupInstallments(summary.installments.filter((i) => i.kind === k));
  const sep = byKind('separacion');
  const ord = byKind('ordinaria');
  const ext = byKind('extraordinaria');
  const separations = summary.installments.filter((i) => i.kind === 'separacion');
  const firstSeparation = separations[0];
  const lastDate = summary.installments.map((i) => i.date).sort().pop();
  const firstDate = summary.installments.map((i) => i.date).sort()[0];
  const spannedMonths = firstDate && lastDate
    ? (Number(lastDate.slice(0, 4)) - Number(firstDate.slice(0, 4))) * 12 + Number(lastDate.slice(5, 7)) - Number(firstDate.slice(5, 7)) + 1
    : 0;
  const severance = plan.severance?.amount ?? 0;
  const balance = plan.landValue - summary.separationTotal - severance;
  const earnest = computeEarnestMoney(plan.landValue, profile.earnestPercent);
  const fecha = fechaEnLetras(input.issuedAt.date);
  const compradores = buyers.map(buyerFields);

  const row = (g: InstallmentGroup | undefined) => g
    ? { n: String(g.count), valor: pesos(g.amount), fecha: formatDMY(g.from) }
    : { n: '', valor: '', fecha: '' };
  const filasCuotas = Array.from({ length: Math.max(sep.length, ord.length, ext.length, 1) }, (_, i) => {
    const s = row(sep[i]); const o = row(ord[i]); const e = row(ext[i]);
    return {
      sepN: s.n, sepValor: s.valor, sepFecha: s.fecha,
      ordN: o.n, ordValor: o.valor, ordFecha: o.fecha,
      extN: e.n, extValor: e.valor, extFecha: e.fecha,
    };
  });
  const groups = (list: InstallmentGroup[]) => list.map((g) => ({
    n: String(g.count), fechas: groupDates(g), valorLetras: pesosEnLetras(g.amount), valor: pesos(g.amount),
  }));

  const titular = compradores[0];
  return {
    compradores,
    ...Object.fromEntries(Object.entries(titular).map(([k, v]) => [`titular.${k}`, v])),

    'vendedor.razonSocial': seller.legalName,
    'vendedor.nit': seller.nit,
    'vendedor.representacion': seller.representation,
    'vendedor.cuenta': seller.bankAccount,
    'vendedor.convenio': seller.bankAgreement,
    'vendedor.esSM': seller.key === 'sm',

    'proyecto.nombre': profile.contractName,
    'proyecto.denominacion': profile.denomination,
    'proyecto.localizacion': profile.location,
    'proyecto.ubicacionDetalle': profile.locationDetail,
    'proyecto.municipio': profile.municipality,
    'proyecto.esCanon': profile.textBlock === 'canon',
    'proyecto.esRioClaro': profile.textBlock === 'rio_claro',
    'proyecto.esLagunaMar': profile.textBlock === 'laguna_mar',
    'proyecto.esLlanoGrande': profile.textBlock === 'llano_grande',

    'lote.numero': lot.lotNumber,
    'lote.sector': lot.sector,
    'lote.area': `${lot.areaM2.toLocaleString('es-CO', { maximumFractionDigits: 2 })} m2`,
    'lote.codigo': lot.lotCode,
    'lote.esquinero': lot.corner ? 'SI' : 'NO',
    'lote.condicion': lot.corner ? 'Esquinero' : 'Medianero',

    'plan.valorTerreno': pesos(plan.landValue),
    'plan.valorTerrenoLetras': pesosEnLetras(plan.landValue),
    'plan.beneficio': pesos(plan.benefit),
    'plan.cesantias': pesos(severance),
    'plan.cesantiasAplica': severance > 0 ? 'Aplica' : 'No Aplica',
    'plan.fondoCesantias': severance > 0 ? plan.severance!.fundName : 'No Aplica',
    'plan.separacion': pesos(summary.separationTotal),
    'plan.separacionLetras': pesosEnLetras(summary.separationTotal),
    'plan.separacionFecha': firstSeparation ? formatDMY(firstSeparation.date) : '',
    // Una cuota de separación por renglón, como la muestra SmartHome.
    'plan.separacionCuotas': separations.map((i) => pesos(i.amount)).join('\n'),
    'plan.separacionFechas': separations.map((i) => formatDMY(i.date)).join('\n'),
    // La promesa repite una fila real por cada pago. `esPrimera` permite mostrar
    // la etiqueta y el total una sola vez; el renderer combina verticalmente esas
    // dos celdas después de que docxtemplater haya creado todas las filas.
    separacionPagos: separations.map((i, index) => ({
      valor: pesos(i.amount),
      fecha: formatDMY(i.date),
      total: pesos(summary.separationTotal),
      esPrimera: index === 0,
    })),
    'plan.totalTerreno': pesos(summary.totalLand),
    'plan.numeroCuotas': String(summary.installments.filter((i) => i.kind === 'ordinaria').length),
    'plan.plazo': String(plan.termMonths || spannedMonths),
    'plan.plazoMeses': String(plan.termMonths || spannedMonths),
    'plan.valorTotal': pesos(summary.installmentsTotal),
    'plan.totalSeparacion': pesos(summary.separationTotal),
    'plan.totalOrdinarias': pesos(summary.ordinaryTotal),
    'plan.totalExtraordinarias': pesos(summary.extraordinaryTotal),
    'plan.saldo': pesos(balance),
    'plan.saldoLetras': pesosEnLetras(balance),
    'plan.tieneBono': (summary.bonusTotal > 0 || (plan.benefit ?? 0) > 0),
    'plan.bono': pesos(summary.bonusTotal > 0 ? summary.bonusTotal : (plan.benefit ?? 0)),
    'plan.bonoLetras': (summary.bonusTotal > 0 || (plan.benefit ?? 0) > 0)
      ? pesosEnLetras(summary.bonusTotal > 0 ? summary.bonusTotal : (plan.benefit ?? 0))
      : '',
    'plan.arras': pesos(earnest),
    'plan.arrasLetras': pesosEnLetras(earnest),
    'plan.referido': plan.referredBy || '',
    'plan.observaciones': plan.notes || '',

    filasCuotas,
    gruposOrdinarias: groups(ord),
    gruposExtraordinarias: groups(ext),

    'fecha.corta': fechaCorta(input.issuedAt.date),
    'fecha.texto': fecha.texto,
    'fecha.dia': fecha.dia,
    'fecha.mesNombre': fecha.mesNombre,
    'fecha.anio': fecha.anio,
    'fecha.diligenciamiento': `${formatDMY(input.issuedAt.date)} ${input.issuedAt.time}`,

    'asesor.nombre': input.advisorName.toUpperCase(),
    'firmas.tituloCompradores': buyers.length > 1 ? 'PROMITENTES COMPRADORES' : 'PROMITENTE COMPRADOR',
  };
}

/**
 * Huella de los datos del negocio (sin las fechas de emisión): la promesa debe salir de
 * exactamente los mismos datos que la preventa.
 */
export function dataHash(data: ContractData): string {
  const stable = Object.fromEntries(Object.entries(data).filter(([k]) => !k.startsWith('fecha.')));
  return createHash('sha256').update(JSON.stringify(stable)).digest('hex');
}

/** Fecha/hora actual en Colombia para el contrato. */
export function bogotaNow(now = new Date()): { date: string; time: string } {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true,
  }).formatToParts(now).map((p) => [p.type, p.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}:${parts.second} ${String(parts.dayPeriod).toUpperCase()}`,
  };
}
