/**
 * Ficha legal por proyecto: reemplaza los bloques "(texto para el proyecto X)" de las
 * plantillas Word 2026. Los datos cortos (vendedor, NIT, cuenta, ubicación) viven aquí;
 * los textos largos (linderos, licencias, amenidades) se quedan en la plantilla Word
 * dentro de secciones condicionales por `textBlock`, para que jurídica los siga editando.
 *
 * El vendedor se decide por el proyecto del inventario, NO por el código de SmartHome:
 * Llano Grande vive dentro del proyecto Cañón en SmartHome pero lo vende ZOMAC.
 */

export interface SellerEntity {
  key:           'zomac' | 'sm';
  legalName:     string;
  nit:           string;
  /** Cadena de representación tal como va en el encabezado de los contratos. */
  representation: string;
  bankAccount:   string;   // cuenta de ahorros Davivienda
  bankAgreement: string;   // número de convenio
}

const LEGAL_REPRESENTATIVE =
  'GRUPO DINHEIRO 1970 S.A.S con Nit.809007305-8 y esta a su vez representada legalmente por ' +
  'JHON ESPER TOLEDO CASTAÑEDA identificado con la Cédula de Ciudadanía No. 12.207.629 de Gigante-Huila';

export const SELLERS: Record<SellerEntity['key'], SellerEntity> = {
  zomac: {
    key: 'zomac',
    legalName: 'GRUPO CONSTRUCTOR MERAKI S.A.S ZOMAC',
    nit: '901110049-0',
    representation:
      'GRUPO CONSTRUCTOR MERAKI S.A.S ZOMAC con Nit. 901110049-0 entidad de derecho privado legalmente ' +
      'constituida como se acredita con el certificado de Existencia y representación legal expedido por la ' +
      `Cámara de Comercio de Ibagué; y a su vez representada por ${LEGAL_REPRESENTATIVE}`,
    bankAccount: '168770042765',
    bankAgreement: '1171362',
  },
  sm: {
    key: 'sm',
    legalName: 'COMPAÑÍA CONSTRUCTORA MERAKI S+M S.A.S',
    nit: '901590498-2',
    representation:
      'COMPAÑÍA CONSTRUCTORA MERAKI S+M S.A.S con Nit. 901590498-2, sociedad legalmente constituida como se ' +
      'acredita con el certificado de Existencia y representación legal, domiciliada en la Ciudad de Ibagué-Tolima ' +
      'y expedido por la cámara de comercio de Ibagué, representada por GRUPO CONSTRUCTOR MERAKI S.A.S ZOMAC con ' +
      'Nit. 901110049-0 entidad de derecho privado legalmente constituida como se acredita con el certificado de ' +
      'Existencia y representación legal expedido por la Cámara de Comercio de Ibagué; y a su vez representada por ' +
      LEGAL_REPRESENTATIVE,
    bankAccount: '108900237588',
    bankAgreement: '1488121',
  },
};

/** Datos de notificación del vendedor (iguales para ambas sociedades). */
export const SELLER_NOTICES = {
  address: 'Carrera 3 # 42 – 92 Barrio Casa Club, Ibagué – Tolima',
  email: 'servicioalcliente.grupomeraki@gmail.com',
  phone: '314 786 80 69',
  paymentsUrl: 'www.grupoconstructormeraki.com.co/pagos',
};

export type ProjectTextBlock = 'canon' | 'laguna_mar' | 'rio_claro' | 'llano_grande' | 'sobre_montanas';

export interface ProjectLegalProfile {
  projectId:     string;            // id del inventario (tour-meraki)
  textBlock:     ProjectTextBlock;  // sección condicional de la plantilla Word
  /** Variante de plantilla Word cuando el proyecto usa estructura jurídica propia (ej. proindiviso). */
  templateVariant?: 'standard' | 'sobre_montanas';
  seller:        SellerEntity['key'];
  contractName:  string;            // PROYECTO en "DATOS GENERALES DEL NEGOCIO"
  /** Cómo nombran los contratos al proyecto ("CLUB DE CAMPO CONDOMINIO ECO HOTEL …"). Revisar con jurídica. */
  denomination:  string;
  /** UBICACIÓN en DETALLES DEL NEGOCIO (va antes de ", cuya área, linderos, …"). */
  locationDetail: string;
  municipality:  string;
  location:      string;            // LOCALIZACIÓN
  earnestPercent: number;           // arras (% del precio)
  /** Textos legales que jurídica aún no entregó; el negocio no puede generar contrato mientras falten. */
  missingTexts:  string[];
}

const PROFILES: ProjectLegalProfile[] = [
  {
    projectId: 'canon-arizona',
    textBlock: 'canon',
    seller: 'sm',
    contractName: 'CAÑON DE ARIZONA BUNGALOW LUXURY CLUB',
    denomination: 'CLUB DE CAMPO CONDOMINIO ECO HOTEL CAÑON DE ARIZONA BUNGALOW LUXURY CLUB',
    locationDetail: 'Via Alvarado Tolima',
    municipality: 'ALVARADO',
    location: 'VIA IBAGUÉ – ALVARADO TOLIMA',
    earnestPercent: 30,
    missingTexts: [],
  },
  {
    projectId: 'laguna-mar',
    textBlock: 'laguna_mar',
    seller: 'zomac',
    contractName: 'CIUDAD COUNTRY LAGUNA MAR BUNGALOW COLIVING CLUB',
    denomination: 'CLUB DE CAMPO CONDOMINIO ECO HOTEL Ciudad Country Laguna Mar Bungalow Coliving Club',
    locationDetail: 'Ruta 40 Express Girardot Bogotá Sector: EL PASO',
    municipality: 'MELGAR',
    location: 'RUTA 40 EXPRESS GIRARDOT BOGOTÁ SECTOR: EL PASO',
    earnestPercent: 30,
    missingTexts: [],
  },
  {
    projectId: 'rio-claro',
    textBlock: 'rio_claro',
    seller: 'zomac',
    contractName: 'RIO CLARO LUXURY LIVING CLUB',
    denomination: 'CLUB DE CAMPO CONDOMINIO ECO HOTEL CONDOMINIO CAMPESTRE RIO CLARO LUXURY LIVING CLUB',
    locationDetail: 'Mariquita Tolima',
    municipality: 'MARIQUITA',
    location: 'VÍA NACIONAL IBAGUÉ-MARIQUITA TOLIMA',
    earnestPercent: 30,
    missingTexts: [],
  },
  {
    projectId: 'llano-grande',
    textBlock: 'llano_grande',
    seller: 'zomac',
    contractName: 'VILLAS CAMPESTRES ECOTURISTICAS - LLANO GRANDE LUXURY LIVING CLUB',
    denomination: 'CONDOMINIO CAMPESTRE Y VILLAS ECOTURÍSTICAS LLANO GRANDE LUXURY LIVING CLUB',
    locationDetail: 'Via Alvarado Tolima',
    municipality: 'ALVARADO',
    location: 'VIA IBAGUÉ – ALVARADO TOLIMA',
    earnestPercent: 30,
    missingTexts: [],
  },
  {
    projectId: 'sobre-montanas',
    textBlock: 'sobre_montanas',
    templateVariant: 'sobre_montanas',
    seller: 'zomac',
    contractName: 'SOBRE MONTAÑAS',
    denomination: 'SOBRE MONTAÑAS',
    locationDetail: 'Alvarado Tolima',
    municipality: 'ALVARADO',
    location: 'ALVARADO – TOLIMA (FINCA NÁPOLES, VEREDA DOYARE)',
    earnestPercent: 30,
    missingTexts: [],
  },
];

/** 'cañon-arizona' → 'canon-arizona', 'sobre-montañas' → 'sobre-montanas'. */
export function normalizeProjectId(projectId: string): string {
  return projectId.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export function getProjectLegalProfile(projectId: string): ProjectLegalProfile | null {
  const id = normalizeProjectId(projectId);
  return PROFILES.find((p) => p.projectId === id) ?? null;
}

export function getSellerForProject(projectId: string): SellerEntity | null {
  const profile = getProjectLegalProfile(projectId);
  return profile ? SELLERS[profile.seller] : null;
}
