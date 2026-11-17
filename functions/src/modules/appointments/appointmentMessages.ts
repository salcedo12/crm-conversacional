import { personFirstName } from '../ai/personName';
import { env } from '../../config/env';
import type { AppointmentModality } from './appointments.types';

/**
 * Textos centralizados de las citas (confirmación, recordatorios y evento de
 * Google Calendar). El nombre del negocio (`businessName`) se pasa como parámetro
 * desde la config de IA por empresa (AiConfig.businessName).
 */

const TZ = () => env.calendarTimeZone();

/** Primer nombre amigable; vacío si es un placeholder tipo "Lead +57...". */
export function friendlyFirstName(name?: string): string {
  return personFirstName(name);
}

/** Hora local, ej "12:00 p. m." */
export function formatTime(date: Date): string {
  return new Intl.DateTimeFormat('es-CO', { timeStyle: 'short', timeZone: TZ() }).format(date);
}

/** Fecha larga, ej "miércoles, 24 de junio de 2026" */
export function formatLongDate(date: Date): string {
  return new Intl.DateTimeFormat('es-CO', { dateStyle: 'full', timeZone: TZ() }).format(date);
}

/** "hoy" / "mañana" / la fecha larga, según el día de la cita. */
export function whenLabel(date: Date): string {
  const fmtDay = (d: Date) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: TZ(), year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  const today = new Date();
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
  const day = fmtDay(date);
  if (day === fmtDay(today))    return 'hoy';
  if (day === fmtDay(tomorrow)) return 'mañana';
  return `el ${formatLongDate(date)}`;
}

/** "llamada telefónica" / "videollamada por Google Meet". */
export function modalityLabel(modality?: AppointmentModality): string {
  return modality === 'videollamada' ? 'videollamada por Google Meet' : 'llamada telefónica';
}

/** Qué pasa a la hora de la cita, según la modalidad. */
function howItWorks(modality?: AppointmentModality): string {
  return modality === 'videollamada'
    ? 'Es una videollamada por Google Meet: le enviaremos el enlace unos minutos antes de la cita.'
    : 'Es una llamada telefónica: su asesor le llamará a este mismo número. Si prefiere videollamada por Google Meet, solo dígamelo.';
}

// ── Confirmación (cuando la IA acaba de agendar) ────────────────────────────
// El enlace de Google Meet NO se envía aquí: se manda en el recordatorio de
// 30 min antes (ver buildReminder30m), para no duplicarlo.
export function buildConfirmation(businessName: string, name: string | undefined, start: Date, modality?: AppointmentModality): string {
  const first = friendlyFirstName(name);
  const hi    = first ? `¡Listo, ${first}!` : '¡Listo!';
  return (
    `✅ ${hi} Su cita con ${businessName} quedó agendada para ${whenLabel(start)} a las ${formatTime(start)}. 🌳\n\n` +
    `${howItWorks(modality)}\n\n` +
    `¡Le esperamos! 😊`
  );
}

// ── Reprogramación (cuando la IA mueve una cita existente) ──────────────────
// Igual que la confirmación: el enlace va en el recordatorio de 30 min antes.
export function buildReschedule(businessName: string, name: string | undefined, start: Date, modality?: AppointmentModality): string {
  const first = friendlyFirstName(name);
  const hi    = first ? `¡Listo, ${first}!` : '¡Listo!';
  return (
    `✅ ${hi} Reprogramé su cita con ${businessName} para ${whenLabel(start)} a las ${formatTime(start)}. 🌳\n\n` +
    `${howItWorks(modality)}\n\n` +
    `¡Le esperamos! 😊`
  );
}

// ── Cancelación ──────────────────────────────────────────────────────────────
export function buildCancellation(businessName: string, name?: string): string {
  const first = friendlyFirstName(name);
  const hi    = first ? `Listo, ${first}.` : 'Listo.';
  return (
    `${hi} Cancelé su cita con ${businessName}. 🗓️\n\n` +
    `Cuando quiera agendar de nuevo, aquí estoy para ayudarle. 😊`
  );
}

// ── Recordatorios ───────────────────────────────────────────────────────────
export function buildReminder24h(businessName: string, name: string | undefined, start: Date): string {
  const first = friendlyFirstName(name);
  const hi    = first ? `¡Hola, ${first}! 👋` : '¡Hola! 👋';
  return (
    `${hi}\n\n` +
    `Le recordamos su cita con ${businessName} para ${whenLabel(start)} a las ${formatTime(start)}. 🌳\n\n` +
    `¡Le esperamos!`
  );
}

export function buildReminder2h(businessName: string, name: string | undefined, start: Date, modality?: AppointmentModality): string {
  const first = friendlyFirstName(name);
  const hi    = first ? `¡Hola, ${first}! 👋` : '¡Hola! 👋';
  return (
    `${hi}\n\n` +
    `Su cita con ${businessName} es hoy a las ${formatTime(start)}. ⏰\n\n` +
    (modality === 'videollamada'
      ? `Unos minutos antes le enviaremos el enlace de Google Meet para la videollamada. 😊`
      : `Su asesor le llamará a este número. ¡Tenga su teléfono a la mano! 📞`)
  );
}

export function buildReminder30m(name: string | undefined, meetLink?: string, modality?: AppointmentModality): string {
  const first = friendlyFirstName(name);
  const who   = first ? `${first}, su` : 'Su';
  if (modality !== 'videollamada') {
    return (
      `📞 ¡${who} cita es en unos minutos!\n\n` +
      `Su asesor le llamará a este número. ¡Tenga su teléfono a la mano! 😊`
    );
  }
  if (meetLink) {
    return (
      `🎥 ¡${who} cita es en unos minutos!\n\n` +
      `Conéctese a la videollamada de Google Meet aquí:\n${meetLink}\n\n` +
      `¡Le esperamos! 😊`
    );
  }
  return (
    `⏰ ¡${who} cita es en unos minutos!\n\n` +
    `En seguida su asesor se comunicará con usted para conectarse. ¡Le esperamos! 😊`
  );
}

// ── Evento de Google Calendar (lo ve el cliente al unirse al Meet) ──────────
/** Sufijo que dice al asesor, a simple vista, si debe llamar o conectarse a Meet. */
export function modalityTitleSuffix(modality?: AppointmentModality): string {
  return modality === 'videollamada' ? 'Videollamada Meet' : 'Llamada';
}

/** "Cita con Ana · Llamada": la modalidad queda visible en la web, la app y Google Calendar. */
export function buildEventTitle(name?: string, modality?: AppointmentModality): string {
  const base = name && !name.startsWith('Lead ') ? `Cita con ${name}` : 'Cita';
  return modality ? `${base} · ${modalityTitleSuffix(modality)}` : base;
}

/** Cambia (o agrega) el sufijo de modalidad de un título de cita ya creado. */
export function retitleForModality(title: string, modality: AppointmentModality): string {
  const base = title.replace(/\s·\s(Llamada|Videollamada Meet)$/, '');
  return `${base} · ${modalityTitleSuffix(modality)}`;
}

export function buildEventDescription(
  businessName: string,
  name: string | undefined,
  fromAi: boolean,
  extra: { phone?: string; modality?: AppointmentModality } = {},
): string {
  const who = name && !name.startsWith('Lead ') ? name : 'el cliente';
  const lines = [
    `Cita agendada para ${who} con ${businessName}.`,
  ];
  if (extra.modality) {
    lines.push(extra.modality === 'videollamada'
      ? 'Modalidad: videollamada por Google Meet (el cliente recibe el enlace 30 minutos antes).'
      : `Modalidad: llamada telefónica. El asesor llama al cliente${extra.phone ? ` al ${extra.phone}` : ''}.`);
  }
  if (extra.phone) lines.push(`Teléfono del cliente: ${extra.phone}`);
  if (fromAi) lines.push('', '— Agendada automáticamente por nuestro asistente virtual. 🤖');
  return lines.join('\n');
}
