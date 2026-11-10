import type { SignatureOptions } from '../services/deals.service';

/**
 * Tipos de firmante sugeridos para una plantilla de DocuBlock, como los usa SmartHome:
 * compradores → el principal ("Cliente" / "PROMITENTE COMPRADOR") y luego los opcionales
 * ("cliente 2", "PROMITENTE COMPRADOR 2"…); Meraki → el obligatorio que queda
 * ("Representante" / "PROMITENTE VENDEDOR") y después "Avalador".
 */

type SignerType = SignatureOptions['templates'][number]['signerTypes'][number];

export const AVALADOR = 'Avalador';

export function defaultTypeSigns(signerTypes: SignerType[], buyerCount: number, merakiCount: number): { buyers: string[]; meraki: string[] } {
  const principal = signerTypes.find((t) => t.principal)?.name;
  const others = signerTypes.filter((t) => !t.principal && t.name !== AVALADOR);
  // Opcionales con número ("cliente 2", "PROMITENTE COMPRADOR 3") son de compradores.
  const buyerExtras = others.filter((t) => /\d\s*$/.test(t.name)).map((t) => t.name);
  const merakiTypes = others.filter((t) => !/\d\s*$/.test(t.name)).map((t) => t.name);

  const buyers = [principal, ...buyerExtras].filter((t): t is string => !!t).slice(0, buyerCount);
  while (buyers.length < buyerCount) buyers.push('');
  const meraki = Array.from({ length: merakiCount }, (_, i) => merakiTypes[i] ?? AVALADOR);
  return { buyers, meraki };
}

const key = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();

/** Nombre del proyecto como aparece en los directorios de DocuBlock. */
const PROJECT_DIRECTORY_NAMES: Record<string, string> = {
  'rio-claro': 'RIO CLARO',
  'cañon-arizona': 'CANON DE ARIZONA',
  'arizona-1': 'ARIZONA 1',
  'arizona-2': 'ARIZONA 2',
  'gran-arizona': 'GRAND ARIZONA',
  'laguna-mar': 'LAGUNA MAR',
  'llano-grande': 'LLANO GRANDE',
};

/** Directorio de promesas del proyecto ("PROMESAS LAGUNA MAR - MELGAR"); si no, el de la plantilla. */
export function defaultDirectory(options: SignatureOptions, templateId: string, projectId: string, _kind: 'preventa' | 'promesa'): string {
  const template = options.templates.find((t) => t.id === templateId);
  const project = PROJECT_DIRECTORY_NAMES[projectId] ?? '';
  // Preventa y promesa van en el mismo directorio de promesas del proyecto.
  if (project) {
    const byProject = options.directories.find((d) => { const k = key(d.name); return k.startsWith('PROMESA') && k.includes(project); });
    if (byProject) return byProject.id;
  }
  return template?.directoryId && options.directories.some((d) => d.id === template.directoryId) ? template.directoryId : '';
}

/**
 * Plantilla sugerida: Meraki usa "PROMESA DE COMPRAVENTA V1" para la preventa y la promesa
 * (si algún día crean una de preventa, se toma esa para la preventa).
 */
export function defaultTemplate(options: SignatureOptions, kind: 'preventa' | 'promesa'): string {
  const find = (word: string) => options.templates.find((t) => key(t.name).includes(word))?.id;
  return (kind === 'preventa' ? find('PREVENTA') : undefined) ?? find('PROMESA') ?? '';
}
