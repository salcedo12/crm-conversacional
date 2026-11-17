import type { Deal, DealStatus, SignatureStatus } from './deals.types';

/** Estados en que el documento sigue en DocuBlock esperando firmas (se consulta). */
export const isPendingSignature = (status: SignatureStatus) => status === 'en_firma' || status === 'firmado_parcial';

/**
 * Documento "vigente" de cada tipo para la firma: el último que se envió a DocuBlock
 * (puede no ser la última versión: se puede escoger cuál enviar); si ninguno, el último.
 */
export const signatureDocOf = (deal: Pick<Deal, 'documents'>, kind: 'preventa' | 'promesa') => {
  const ofKind = [...(deal.documents ?? [])].filter((d) => d.kind === kind);
  const sent = ofKind.filter((d) => d.docublockDocumentId).sort((a, b) => (a.sentAt?.toMillis?.() ?? 0) - (b.sentAt?.toMillis?.() ?? 0));
  // Sin envíos: el último no vencido por cambio de lote (o el último, si todos lo están).
  return sent.at(-1) ?? ofKind.filter((d) => !d.superseded).at(-1) ?? ofKind.at(-1);
};
const latest = signatureDocOf;

/**
 * Estado del negocio según la firma (preventa y promesa se envían a la vez):
 * - promesa_firmada: las dos firmadas.
 * - promesa_en_firma: preventa firmada, falta la promesa.
 * - preventa_en_firma: algo enviado y la preventa sin terminar.
 * Si nada está en firma (anulado/vencido/sin enviar) vuelve a "plan_listo".
 */
export function signatureDealStatus(deal: Pick<Deal, 'documents' | 'status'>): DealStatus {
  if (deal.status === 'anulado') return 'anulado';
  const preventa = latest(deal, 'preventa');
  const promesa = latest(deal, 'promesa');
  const signed = (s?: SignatureStatus) => s === 'firmado';
  const active = (s?: SignatureStatus) => !!s && (isPendingSignature(s) || s === 'firmado');
  if (signed(preventa?.signatureStatus) && signed(promesa?.signatureStatus)) return 'promesa_firmada';
  if (signed(preventa?.signatureStatus)) return 'promesa_en_firma';
  if (active(preventa?.signatureStatus) || active(promesa?.signatureStatus)) return 'preventa_en_firma';
  return 'plan_listo';
}
