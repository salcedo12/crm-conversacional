import { httpsCallable } from 'firebase/functions';
import { functions } from '@/config/firebase';

export interface CountryPrefixOption {
  iso: string;       // ISO 3166-1 alpha-2 lowercase, ej. 'co', 'us', 'es'
  code: string;      // Indicativo con +, ej. '+57'
  name: string;      // Nombre en español, ej. 'Colombia'
  minDigits: number; // Mínimo de dígitos nacionales (sin incluir indicativo)
  maxDigits: number; // Máximo de dígitos nacionales
  placeholder: string;
  featured?: boolean;
}

/**
 * Directorio mundial completo de países e indicativos telefónicos (ITU-T E.164).
 * Rígido: no existe opción "libre/manual", garantizando que todo teléfono quede normalizado sin duplicados.
 */
export const COUNTRY_PREFIX_OPTIONS: CountryPrefixOption[] = [
  // Destacados / más frecuentes en Meraki
  { iso: 'co', code: '+57',   name: 'Colombia',                 minDigits: 10, maxDigits: 10, placeholder: '310 123 4567', featured: true },
  { iso: 'us', code: '+1',    name: 'Estados Unidos',           minDigits: 10, maxDigits: 10, placeholder: '305 555 1234', featured: true },
  { iso: 'ca', code: '+1',    name: 'Canadá',                   minDigits: 10, maxDigits: 10, placeholder: '416 555 1234', featured: true },
  { iso: 'es', code: '+34',   name: 'España',                   minDigits: 9,  maxDigits: 9,  placeholder: '641 357 991',  featured: true },
  { iso: 'mx', code: '+52',   name: 'México',                   minDigits: 10, maxDigits: 10, placeholder: '55 1234 5678', featured: true },
  { iso: 'pa', code: '+507',  name: 'Panamá',                   minDigits: 7,  maxDigits: 8,  placeholder: '6123 4567',    featured: true },
  { iso: 'cl', code: '+56',   name: 'Chile',                    minDigits: 9,  maxDigits: 9,  placeholder: '9 8765 4321',  featured: true },
  { iso: 'ec', code: '+593',  name: 'Ecuador',                  minDigits: 9,  maxDigits: 9,  placeholder: '99 123 4567',  featured: true },
  { iso: 'pe', code: '+51',   name: 'Perú',                     minDigits: 9,  maxDigits: 9,  placeholder: '987 654 321',  featured: true },
  { iso: 'ar', code: '+54',   name: 'Argentina',                minDigits: 10, maxDigits: 11, placeholder: '9 11 1234 5678', featured: true },
  { iso: 'cr', code: '+506',  name: 'Costa Rica',               minDigits: 8,  maxDigits: 8,  placeholder: '8765 4321',    featured: true },
  { iso: 'br', code: '+55',   name: 'Brasil',                   minDigits: 10, maxDigits: 11, placeholder: '11 98765 4321', featured: true },
  { iso: 'gb', code: '+44',   name: 'Reino Unido',              minDigits: 10, maxDigits: 10, placeholder: '7700 900077',  featured: true },
  { iso: 'fr', code: '+33',   name: 'Francia',                  minDigits: 9,  maxDigits: 9,  placeholder: '6 12 34 56 78', featured: true },
  { iso: 'de', code: '+49',   name: 'Alemania',                 minDigits: 9,  maxDigits: 11, placeholder: '1512 3456789', featured: true },
  { iso: 'it', code: '+39',   name: 'Italia',                   minDigits: 9,  maxDigits: 10, placeholder: '312 345 6789', featured: true },
  { iso: 'ch', code: '+41',   name: 'Suiza',                    minDigits: 9,  maxDigits: 9,  placeholder: '78 123 45 67', featured: true },
  { iso: 'au', code: '+61',   name: 'Australia',                minDigits: 9,  maxDigits: 9,  placeholder: '412 345 678',  featured: true },
  { iso: 'ae', code: '+971',  name: 'Emiratos Árabes Unidos',   minDigits: 9,  maxDigits: 9,  placeholder: '50 123 4567',  featured: true },

  // Resto del mundo (orden alfabético en español)
  { iso: 'af', code: '+93',   name: 'Afganistán',               minDigits: 9,  maxDigits: 9,  placeholder: '70 123 4567' },
  { iso: 'al', code: '+355',  name: 'Albania',                  minDigits: 8,  maxDigits: 9,  placeholder: '67 212 3456' },
  { iso: 'ad', code: '+376',  name: 'Andorra',                  minDigits: 6,  maxDigits: 9,  placeholder: '312 345' },
  { iso: 'ao', code: '+244',  name: 'Angola',                   minDigits: 9,  maxDigits: 9,  placeholder: '923 123 456' },
  { iso: 'ag', code: '+1268', name: 'Antigua y Barbuda',        minDigits: 7,  maxDigits: 7,  placeholder: '464 1234' },
  { iso: 'sa', code: '+966',  name: 'Arabia Saudita',           minDigits: 9,  maxDigits: 9,  placeholder: '51 234 5678' },
  { iso: 'dz', code: '+213',  name: 'Argelia',                  minDigits: 9,  maxDigits: 9,  placeholder: '551 23 45 67' },
  { iso: 'am', code: '+374',  name: 'Armenia',                  minDigits: 8,  maxDigits: 8,  placeholder: '77 123456' },
  { iso: 'aw', code: '+297',  name: 'Aruba',                    minDigits: 7,  maxDigits: 7,  placeholder: '560 1234' },
  { iso: 'at', code: '+43',   name: 'Austria',                  minDigits: 9,  maxDigits: 13, placeholder: '664 123456' },
  { iso: 'az', code: '+994',  name: 'Azerbaiyán',               minDigits: 9,  maxDigits: 9,  placeholder: '40 123 45 67' },
  { iso: 'bs', code: '+1242', name: 'Bahamas',                  minDigits: 7,  maxDigits: 7,  placeholder: '359 1234' },
  { iso: 'bd', code: '+880',  name: 'Bangladés',                minDigits: 10, maxDigits: 10, placeholder: '1812 345678' },
  { iso: 'bb', code: '+1246', name: 'Barbados',                 minDigits: 7,  maxDigits: 7,  placeholder: '250 1234' },
  { iso: 'bh', code: '+973',  name: 'Baréin',                   minDigits: 8,  maxDigits: 8,  placeholder: '3600 1234' },
  { iso: 'be', code: '+32',   name: 'Bélgica',                  minDigits: 8,  maxDigits: 9,  placeholder: '470 12 34 56' },
  { iso: 'bz', code: '+501',  name: 'Belice',                   minDigits: 7,  maxDigits: 7,  placeholder: '622 1234' },
  { iso: 'bj', code: '+229',  name: 'Benín',                    minDigits: 8,  maxDigits: 8,  placeholder: '90 01 12 34' },
  { iso: 'by', code: '+375',  name: 'Bielorrusia',              minDigits: 9,  maxDigits: 9,  placeholder: '29 491 19 11' },
  { iso: 'bo', code: '+591',  name: 'Bolivia',                  minDigits: 8,  maxDigits: 8,  placeholder: '71234567' },
  { iso: 'ba', code: '+387',  name: 'Bosnia y Herzegovina',     minDigits: 8,  maxDigits: 8,  placeholder: '61 123 456' },
  { iso: 'bw', code: '+267',  name: 'Botsuana',                 minDigits: 8,  maxDigits: 8,  placeholder: '71 123 456' },
  { iso: 'bn', code: '+673',  name: 'Brunéi',                   minDigits: 7,  maxDigits: 7,  placeholder: '712 3456' },
  { iso: 'bg', code: '+359',  name: 'Bulgaria',                 minDigits: 8,  maxDigits: 9,  placeholder: '48 123 456' },
  { iso: 'bf', code: '+226',  name: 'Burkina Faso',             minDigits: 8,  maxDigits: 8,  placeholder: '70 12 34 56' },
  { iso: 'bi', code: '+257',  name: 'Burundi',                  minDigits: 8,  maxDigits: 8,  placeholder: '79 56 12 34' },
  { iso: 'cv', code: '+238',  name: 'Cabo Verde',               minDigits: 7,  maxDigits: 7,  placeholder: '991 12 34' },
  { iso: 'kh', code: '+855',  name: 'Camboya',                  minDigits: 8,  maxDigits: 9,  placeholder: '91 234 567' },
  { iso: 'cm', code: '+237',  name: 'Camerún',                  minDigits: 9,  maxDigits: 9,  placeholder: '6 71 23 45 67' },
  { iso: 'qa', code: '+974',  name: 'Catar',                    minDigits: 8,  maxDigits: 8,  placeholder: '3312 3456' },
  { iso: 'td', code: '+235',  name: 'Chad',                     minDigits: 8,  maxDigits: 8,  placeholder: '63 01 23 45' },
  { iso: 'CN', code: '+86',   name: 'China',                    minDigits: 11, maxDigits: 11, placeholder: '131 2345 6789' },
  { iso: 'cy', code: '+357',  name: 'Chipre',                   minDigits: 8,  maxDigits: 8,  placeholder: '96 123456' },
  { iso: 'kr', code: '+82',   name: 'Corea del Sur',            minDigits: 9,  maxDigits: 10, placeholder: '10 2345 6789' },
  { iso: 'ci', code: '+225',  name: 'Costa de Marfil',          minDigits: 10, maxDigits: 10, placeholder: '01 23 45 67 89' },
  { iso: 'hr', code: '+385',  name: 'Croacia',                  minDigits: 8,  maxDigits: 9,  placeholder: '92 123 4567' },
  { iso: 'cu', code: '+53',   name: 'Cuba',                     minDigits: 8,  maxDigits: 8,  placeholder: '5 1234567' },
  { iso: 'cw', code: '+599',  name: 'Curazao',                  minDigits: 7,  maxDigits: 8,  placeholder: '9 518 1234' },
  { iso: 'dk', code: '+45',   name: 'Dinamarca',                minDigits: 8,  maxDigits: 8,  placeholder: '32 12 34 56' },
  { iso: 'dm', code: '+1767', name: 'Dominica',                 minDigits: 7,  maxDigits: 7,  placeholder: '225 1234' },
  { iso: 'eg', code: '+20',   name: 'Egipto',                   minDigits: 10, maxDigits: 10, placeholder: '100 123 4567' },
  { iso: 'sv', code: '+503',  name: 'El Salvador',              minDigits: 8,  maxDigits: 8,  placeholder: '7012 3456' },
  { iso: 'sk', code: '+421',  name: 'Eslovaquia',               minDigits: 9,  maxDigits: 9,  placeholder: '912 123 456' },
  { iso: 'si', code: '+386',  name: 'Eslovenia',                minDigits: 8,  maxDigits: 8,  placeholder: '31 234 567' },
  { iso: 'ee', code: '+372',  name: 'Estonia',                  minDigits: 7,  maxDigits: 8,  placeholder: '5123 4567' },
  { iso: 'et', code: '+251',  name: 'Etiopía',                  minDigits: 9,  maxDigits: 9,  placeholder: '91 123 4567' },
  { iso: 'ph', code: '+63',   name: 'Filipinas',                minDigits: 10, maxDigits: 10, placeholder: '905 123 4567' },
  { iso: 'fi', code: '+358',  name: 'Finlandia',                minDigits: 8,  maxDigits: 10, placeholder: '41 2345678' },
  { iso: 'ge', code: '+995',  name: 'Georgia',                  minDigits: 9,  maxDigits: 9,  placeholder: '555 12 34 56' },
  { iso: 'gh', code: '+233',  name: 'Ghana',                    minDigits: 9,  maxDigits: 9,  placeholder: '23 123 4567' },
  { iso: 'gd', code: '+1473', name: 'Granada',                  minDigits: 7,  maxDigits: 7,  placeholder: '403 1234' },
  { iso: 'gr', code: '+30',   name: 'Grecia',                   minDigits: 10, maxDigits: 10, placeholder: '691 234 5678' },
  { iso: 'gt', code: '+502',  name: 'Guatemala',                minDigits: 8,  maxDigits: 8,  placeholder: '5123 4567' },
  { iso: 'gy', code: '+592',  name: 'Guyana',                   minDigits: 7,  maxDigits: 7,  placeholder: '609 1234' },
  { iso: 'ht', code: '+509',  name: 'Haití',                    minDigits: 8,  maxDigits: 8,  placeholder: '34 10 1234' },
  { iso: 'hn', code: '+504',  name: 'Honduras',                 minDigits: 8,  maxDigits: 8,  placeholder: '9123 4567' },
  { iso: 'hk', code: '+852',  name: 'Hong Kong',                minDigits: 8,  maxDigits: 8,  placeholder: '5123 4567' },
  { iso: 'hu', code: '+36',   name: 'Hungría',                  minDigits: 9,  maxDigits: 9,  placeholder: '20 123 4567' },
  { iso: 'in', code: '+91',   name: 'India',                    minDigits: 10, maxDigits: 10, placeholder: '98765 43210' },
  { iso: 'id', code: '+62',   name: 'Indonesia',                minDigits: 9,  maxDigits: 12, placeholder: '812 345 678' },
  { iso: 'iq', code: '+964',  name: 'Irak',                     minDigits: 10, maxDigits: 10, placeholder: '791 234 5678' },
  { iso: 'ir', code: '+98',   name: 'Irán',                     minDigits: 10, maxDigits: 10, placeholder: '912 345 6789' },
  { iso: 'ie', code: '+353',  name: 'Irlanda',                  minDigits: 9,  maxDigits: 9,  placeholder: '85 012 3456' },
  { iso: 'is', code: '+354',  name: 'Islandia',                 minDigits: 7,  maxDigits: 7,  placeholder: '611 1234' },
  { iso: 'il', code: '+972',  name: 'Israel',                   minDigits: 9,  maxDigits: 9,  placeholder: '50 234 5678' },
  { iso: 'jm', code: '+1876', name: 'Jamaica',                  minDigits: 7,  maxDigits: 7,  placeholder: '210 1234' },
  { iso: 'jp', code: '+81',   name: 'Japón',                    minDigits: 10, maxDigits: 10, placeholder: '90 1234 5678' },
  { iso: 'jo', code: '+962',  name: 'Jordania',                 minDigits: 9,  maxDigits: 9,  placeholder: '7 9012 3456' },
  { iso: 'kz', code: '+7',    name: 'Kazajistán',               minDigits: 10, maxDigits: 10, placeholder: '771 000 9998' },
  { iso: 'ke', code: '+254',  name: 'Kenia',                    minDigits: 9,  maxDigits: 9,  placeholder: '712 123456' },
  { iso: 'kw', code: '+965',  name: 'Kuwait',                   minDigits: 8,  maxDigits: 8,  placeholder: '500 12345' },
  { iso: 'lv', code: '+371',  name: 'Letonia',                  minDigits: 8,  maxDigits: 8,  placeholder: '21 234 567' },
  { iso: 'lb', code: '+961',  name: 'Líbano',                   minDigits: 7,  maxDigits: 8,  placeholder: '71 123 456' },
  { iso: 'lt', code: '+370',  name: 'Lituania',                 minDigits: 8,  maxDigits: 8,  placeholder: '612 34567' },
  { iso: 'lu', code: '+352',  name: 'Luxemburgo',               minDigits: 8,  maxDigits: 9,  placeholder: '628 123 456' },
  { iso: 'my', code: '+60',   name: 'Malasia',                  minDigits: 9,  maxDigits: 10, placeholder: '12 345 6789' },
  { iso: 'mt', code: '+356',  name: 'Malta',                    minDigits: 8,  maxDigits: 8,  placeholder: '9696 1234' },
  { iso: 'ma', code: '+212',  name: 'Marruecos',                minDigits: 9,  maxDigits: 9,  placeholder: '650 123456' },
  { iso: 'md', code: '+373',  name: 'Moldavia',                 minDigits: 8,  maxDigits: 8,  placeholder: '621 12 345' },
  { iso: 'mc', code: '+377',  name: 'Mónaco',                   minDigits: 8,  maxDigits: 9,  placeholder: '6 12 34 56 78' },
  { iso: 'me', code: '+382',  name: 'Montenegro',               minDigits: 8,  maxDigits: 8,  placeholder: '67 622 901' },
  { iso: 'ni', code: '+505',  name: 'Nicaragua',                minDigits: 8,  maxDigits: 8,  placeholder: '8123 4567' },
  { iso: 'ng', code: '+234',  name: 'Nigeria',                  minDigits: 10, maxDigits: 10, placeholder: '802 123 4567' },
  { iso: 'no', code: '+47',   name: 'Noruega',                  minDigits: 8,  maxDigits: 8,  placeholder: '406 12 345' },
  { iso: 'nz', code: '+64',   name: 'Nueva Zelanda',            minDigits: 8,  maxDigits: 10, placeholder: '21 123 4567' },
  { iso: 'nl', code: '+31',   name: 'Países Bajos (Holanda)',   minDigits: 9,  maxDigits: 9,  placeholder: '6 12345678' },
  { iso: 'pk', code: '+92',   name: 'Pakistán',                 minDigits: 10, maxDigits: 10, placeholder: '301 2345678' },
  { iso: 'py', code: '+595',  name: 'Paraguay',                 minDigits: 9,  maxDigits: 9,  placeholder: '961 456789' },
  { iso: 'pl', code: '+48',   name: 'Polonia',                  minDigits: 9,  maxDigits: 9,  placeholder: '512 345 678' },
  { iso: 'pt', code: '+351',  name: 'Portugal',                 minDigits: 9,  maxDigits: 9,  placeholder: '912 345 678' },
  { iso: 'pr', code: '+1787', name: 'Puerto Rico',              minDigits: 7,  maxDigits: 7,  placeholder: '234 5678' },
  { iso: 'do', code: '+1809', name: 'República Dominicana',     minDigits: 7,  maxDigits: 7,  placeholder: '234 5678' },
  { iso: 'cz', code: '+420',  name: 'República Checa',          minDigits: 9,  maxDigits: 9,  placeholder: '601 123 456' },
  { iso: 'ro', code: '+40',   name: 'Rumania',                  minDigits: 9,  maxDigits: 9,  placeholder: '712 034 567' },
  { iso: 'ru', code: '+7',    name: 'Rusia',                    minDigits: 10, maxDigits: 10, placeholder: '912 345 67 89' },
  { iso: 'sn', code: '+221',  name: 'Senegal',                  minDigits: 9,  maxDigits: 9,  placeholder: '70 123 45 67' },
  { iso: 'rs', code: '+381',  name: 'Serbia',                   minDigits: 8,  maxDigits: 9,  placeholder: '60 1234567' },
  { iso: 'sg', code: '+65',   name: 'Singapur',                 minDigits: 8,  maxDigits: 8,  placeholder: '8123 4567' },
  { iso: 'za', code: '+27',   name: 'Sudáfrica',                minDigits: 9,  maxDigits: 9,  placeholder: '71 123 4567' },
  { iso: 'se', code: '+46',   name: 'Suecia',                   minDigits: 9,  maxDigits: 9,  placeholder: '70 123 45 67' },
  { iso: 'th', code: '+66',   name: 'Tailandia',                minDigits: 9,  maxDigits: 9,  placeholder: '81 234 5678' },
  { iso: 'tw', code: '+886',  name: 'Taiwán',                   minDigits: 9,  maxDigits: 9,  placeholder: '912 345 678' },
  { iso: 'tt', code: '+1868', name: 'Trinidad y Tobago',        minDigits: 7,  maxDigits: 7,  placeholder: '291 1234' },
  { iso: 'tn', code: '+216',  name: 'Túnez',                    minDigits: 8,  maxDigits: 8,  placeholder: '20 123 456' },
  { iso: 'tr', code: '+90',   name: 'Turquía',                  minDigits: 10, maxDigits: 10, placeholder: '501 234 56 78' },
  { iso: 'ua', code: '+380',  name: 'Ucrania',                  minDigits: 9,  maxDigits: 9,  placeholder: '50 123 4567' },
  { iso: 'uy', code: '+598',  name: 'Uruguay',                  minDigits: 8,  maxDigits: 8,  placeholder: '94 231 234' },
  { iso: 've', code: '+58',   name: 'Venezuela',                minDigits: 10, maxDigits: 10, placeholder: '412 1234567' },
  { iso: 'vn', code: '+84',   name: 'Vietnam',                  minDigits: 9,  maxDigits: 10, placeholder: '91 234 56 78' },
];

export function getCountryByIso(iso: string): CountryPrefixOption {
  const lower = iso.toLowerCase();
  return (
    COUNTRY_PREFIX_OPTIONS.find((o) => o.iso.toLowerCase() === lower) ||
    COUNTRY_PREFIX_OPTIONS[0]
  );
}

/**
 * Si el asesor pega un número con `+` (ej. `+34 641 357 991` o `+1 305 555 1234`),
 * detecta automáticamente el país correspondiente y deja solo los dígitos locales.
 */
export function detectCountryFromInput(
  rawInput: string,
  currentIso: string
): { iso: string; localDigits: string } {
  const trimmed = rawInput.trim();
  const currentOpt = getCountryByIso(currentIso);

  if (!trimmed.startsWith('+') && !trimmed.startsWith('00')) {
    return {
      iso: currentOpt.iso,
      localDigits: rawInput.replace(/\D/g, '').slice(0, currentOpt.maxDigits + 3),
    };
  }

  const normalizedPlus = trimmed.startsWith('00') ? `+${trimmed.slice(2).trim()}` : trimmed;
  const digitsWithPlus = `+${normalizedPlus.replace(/\D/g, '')}`;

  // Ordenar por longitud de indicativo descendente (+1809, +593, +507, +57, +1)
  const sorted = [...COUNTRY_PREFIX_OPTIONS].sort((a, b) => b.code.length - a.code.length);

  for (const opt of sorted) {
    if (digitsWithPlus.startsWith(opt.code) && digitsWithPlus.length > opt.code.length + 4) {
      const restDigits = digitsWithPlus.slice(opt.code.length).slice(0, opt.maxDigits);
      return { iso: opt.iso, localDigits: restDigits };
    }
  }

  return {
    iso: currentOpt.iso,
    localDigits: rawInput.replace(/\D/g, '').slice(0, currentOpt.maxDigits),
  };
}

/**
 * Construye el número internacional E.164 rígido (`+57...`, `+1...`, `+34...`)
 * y valida que cumpla exactamente la longitud de dígitos del país seleccionado.
 */
export function buildInternationalPhone(
  isoOrCode: string,
  localValue: string
): { fullPhone: string; isValidLength: boolean; digitsCount: number; country: CountryPrefixOption } {
  const opt =
    COUNTRY_PREFIX_OPTIONS.find(
      (o) => o.iso.toLowerCase() === isoOrCode.toLowerCase() || o.code === isoOrCode
    ) || COUNTRY_PREFIX_OPTIONS[0];

  const cleanDigits = localValue.replace(/\D/g, '');
  const prefixDigits = opt.code.replace(/\D/g, '');
  let nationalDigits = cleanDigits;

  // Evitar duplicar el código de país si el usuario pegó p.ej. 573001234567 con Colombia seleccionado
  if (
    nationalDigits.startsWith(prefixDigits) &&
    nationalDigits.length >= prefixDigits.length + opt.minDigits &&
    nationalDigits.length <= prefixDigits.length + opt.maxDigits
  ) {
    nationalDigits = nationalDigits.slice(prefixDigits.length);
  }

  nationalDigits = nationalDigits.slice(0, opt.maxDigits);
  const fullDigits = `${prefixDigits}${nationalDigits}`;

  return {
    fullPhone: nationalDigits ? `+${fullDigits}` : '',
    isValidLength:
      nationalDigits.length >= opt.minDigits &&
      nationalDigits.length <= opt.maxDigits &&
      fullDigits.length >= 8 &&
      fullDigits.length <= 15,
    digitsCount: nationalDigits.length,
    country: opt,
  };
}

export interface CreateContactInput {
  companyId: string;
  name?: string;
  phone: string;
  email?: string;
  company?: string;
  project?: string;
  tags?: string[];
  assignedTo?: string;
  notes?: string;
  fuenteUbicacion?: string;
}

export interface CreateContactResult {
  leadId: string;
  /** true si ya existía un lead con ese número (no se duplicó). */
  existed: boolean;
  /** true si fue reclamado tras >30 días de abandono o sin asesor previo. */
  reclaimed?: boolean;
}

export interface PhoneAvailabilityResult {
  status: 'invalid' | 'available' | 'own' | 'reclaimable' | 'locked_by_other';
  normalizedPhone?: string;
  message?: string;
  leadId?: string;
  leadName?: string;
  advisorId?: string | null;
  advisorName?: string;
  daysSinceActivity?: number | null;
  project?: string;
  fuenteUbicacion?: string;
  hasPendingRequest?: boolean;
}

export interface LeadTransferRequestItem {
  id: string;
  leadId: string;
  leadName: string;
  leadPhone: string;
  leadProject: string;
  leadSource: string;
  requesterId: string;
  requesterName: string;
  currentAdvisorId: string | null;
  currentAdvisorName: string;
  targetAdvisorId?: string | null;
  targetAdvisorName?: string | null;
  isReassignmentRequest?: boolean;
  lastFollowUpMillis: number | null;
  daysSinceFollowUp: number | null;
  lastFollowUpSummary: string;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAtMillis: number;
  resolvedAtMillis: number | null;
  resolvedByName: string;
  adminNote: string;
}

const _create = httpsCallable<CreateContactInput, CreateContactResult>(functions, 'createContact');
const _checkPhone = httpsCallable<{ companyId: string; phone: string }, PhoneAvailabilityResult>(
  functions,
  'checkPhoneAvailability'
);
const _requestTransfer = httpsCallable<
  { companyId: string; leadId?: string; phone?: string; reason?: string; targetAdvisorId?: string },
  { requestId: string; alreadyPending: boolean }
>(functions, 'requestLeadTransfer');

const _listTransfers = httpsCallable<
  { companyId: string; status?: 'pending' | 'approved' | 'rejected' | 'all' },
  { requests: LeadTransferRequestItem[] }
>(functions, 'listLeadTransferRequests');

const _resolveTransfer = httpsCallable<
  { companyId: string; requestId: string; decision: 'approve' | 'reject'; adminNote?: string; targetAdvisorId?: string },
  { ok: boolean; status: 'approved' | 'reject'; leadId: string }
>(functions, 'resolveLeadTransferRequest');

/** Crea un contacto (lead) manual por número para iniciarle conversación por plantilla. */
export async function createContact(input: CreateContactInput): Promise<CreateContactResult> {
  return (await _create(input)).data;
}

/** Valida en tiempo real si un número celular está libre, pertenece al asesor o caducó por abandono (>30 días). */
export async function checkPhoneAvailability(companyId: string, phone: string): Promise<PhoneAvailabilityResult> {
  return (await _checkPhone({ companyId, phone })).data;
}

/** Solicita al Administrador el traslado de un prospecto actualmente asignado a otro asesor. */
export async function requestLeadTransfer(input: {
  companyId: string;
  leadId?: string;
  phone?: string;
  reason?: string;
  targetAdvisorId?: string;
}): Promise<{ requestId: string; alreadyPending: boolean }> {
  return (await _requestTransfer(input)).data;
}

/** Lista las solicitudes de traslado (para Administradores o del asesor actual). */
export async function listLeadTransferRequests(
  companyId: string,
  status: 'pending' | 'approved' | 'rejected' | 'all' = 'all'
): Promise<LeadTransferRequestItem[]> {
  return (await _listTransfers({ companyId, status })).data.requests || [];
}

/** Permite al Administrador aprobar o rechazar una solicitud de traslado. */
export async function resolveLeadTransferRequest(input: {
  companyId: string;
  requestId: string;
  decision: 'approve' | 'reject';
  adminNote?: string;
  targetAdvisorId?: string;
}): Promise<{ ok: boolean; status: 'approved' | 'reject'; leadId: string }> {
  return (await _resolveTransfer(input)).data;
}
