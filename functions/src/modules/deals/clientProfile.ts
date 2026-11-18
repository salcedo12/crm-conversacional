import { z } from 'zod';
import { parseCivilDate } from './civilDate';

/**
 * Validación de la ficha del comprador (lo que pide SmartHome y arrastra a la preventa,
 * la promesa y DocuBlock). Persona natural exige fecha de nacimiento, estado civil y
 * género; persona jurídica no (el nombre va en `firstNames` y el NIT como identificación).
 */

const civilDate = z.string().refine((value) => {
  try { parseCivilDate(value); return true; } catch { return false; }
}, 'Fecha inválida');

export const ClientInputSchema = z.object({
  personKind:           z.enum(['natural', 'juridica']),
  firstNames:           z.string().trim().min(1).max(120),
  lastNames:            z.string().trim().max(120).default(''),
  birthDate:            civilDate.optional(),
  maritalStatus:        z.enum(['soltero', 'casado', 'union_libre', 'divorciado', 'viudo', 'separado']).optional(),
  gender:               z.enum(['masculino', 'femenino', 'otro']).optional(),
  residenceCity:        z.string().trim().min(1).max(120),
  /** País como lo escribe DocuBlock ("Colombia", "España"…); sin valor = Colombia. */
  residenceCountry:     z.string().trim().max(80).optional(),
  address:              z.string().trim().min(1).max(200),
  identificationKind:   z.enum(['CC', 'CE', 'NIT', 'PAS', 'PPT', 'TI']),
  identificationNumber: z.string().trim().min(3).max(30),
  expeditionCity:       z.string().trim().min(1).max(120),
  expeditionCountry:    z.string().trim().max(80).optional(),
  expeditionDate:       civilDate,
  mobile:               z.string().trim().regex(/^\+\d{8,15}$/, 'Celular en formato +57...'),
  email:                z.string().trim().toLowerCase().email(),
}).superRefine((client, ctx) => {
  if (client.personKind === 'natural') {
    if (!client.lastNames) ctx.addIssue({ code: 'custom', path: ['lastNames'], message: 'Faltan los apellidos' });
    if (!client.birthDate) ctx.addIssue({ code: 'custom', path: ['birthDate'], message: 'Falta la fecha de nacimiento' });
    if (!client.maritalStatus) ctx.addIssue({ code: 'custom', path: ['maritalStatus'], message: 'Falta el estado civil' });
    if (!client.gender) ctx.addIssue({ code: 'custom', path: ['gender'], message: 'Falta el género' });
  }
  if (client.birthDate && client.expeditionDate < client.birthDate) {
    ctx.addIssue({ code: 'custom', path: ['expeditionDate'], message: 'La expedición no puede ser anterior al nacimiento' });
  }
});

export type ClientInput = z.infer<typeof ClientInputSchema>;

/** Número de identificación sin puntos ni espacios ('1.000.000.001' → '1000000001'; el NIT conserva '-0'). */
export function normalizeIdentification(value: string): string {
  return value.replace(/[.\s]/g, '').toUpperCase();
}

/** Id determinístico de la ficha: una persona = una ficha por empresa, sin consultas de duplicados. */
export function clientDocId(identificationKind: string, identificationNumber: string): string {
  return `${identificationKind}-${normalizeIdentification(identificationNumber)}`;
}

/** Límite técnico amplio de compradores por negocio; en DocuBlock los adicionales usan "Avalador". */
export const MAX_BUYERS = 20;
