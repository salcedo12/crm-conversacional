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
  if (!name || name.startsWith('Lead ')) return '';
  return name.trim().split(/\s+/)[0] ?? '';
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
    ? 'Es una videollamada por Google Meet: te enviaremos el enlace unos minutos antes de la cita.'
    : 'Es una llamada telefónica: tu asesor te llamará a este mismo número. Si prefieres videollamada por Google Meet, solo dímelo.';
}

// ── Confirmación (cuando la IA acaba de agendar) ────────────────────────────
// El enlace de Google Meet NO se envía aquí: se manda en el recordatorio de
// 30 min antes (ver buildReminder30m), para no duplicarlo.
export function buildConfirmation(businessName: string, name: string | undefined, start: Date, modality?: AppointmentModality): string {
  const first = friendlyFirstName(name);
  const hi    = first ? `¡Listo, ${first}!` : '¡Listo!';
  return (
    `✅ ${hi} Tu cita con ${businessName} quedó agendada para ${whenLabel(start)} a las ${formatTime(start)}. 🌳\n\n` +
    `${howItWorks(modality)}\n\n` +
    `¡Te esperamos! 😊`
  );
}

// ── Reprogramación (cuando la IA mueve una cita existente) ──────────────────
// Igual que la confirmación: el enlace va en el recordatorio de 30 min antes.
export function buildReschedule(businessName: string, name: string | undefined, start: Date, modality?: AppointmentModality): string {
  const first = friendlyFirstName(name);
  const hi    = first ? `¡Listo, ${first}!` : '¡Listo!';
  return (
    `✅ ${hi} Reprogramé tu cita con ${businessName} para ${whenLabel(start)} a las ${formatTime(start)}. 🌳\n\n` +
    `${howItWorks(modality)}\n\n` +
    `¡Te esperamos! 😊`
  );
}

// ── Cancelación ──────────────────────────────────────────────────────────────
export function buildCancellation(businessName: string, name?: string): string {
  const first = friendlyFirstName(name);
  const hi    = first ? `Listo, ${first}.` : 'Listo.';
  return (
    `${hi} Cancelé tu cita con ${businessName}. 🗓️\n\n` +
    `Cuando quieras agendar de nuevo, aquí estoy para ayudarte. 😊`
  );
}

// ── Recordatorios ───────────────────────────────────────────────────────────
export function buildReminder24h(businessName: string, name: string | undefined, start: Date): string {
  const first = friendlyFirstName(name);
  const hi    = first ? `¡Hola, ${first}! 👋` : '¡Hola! 👋';
  return (
    `${hi}\n\n` +
    `Te recordamos tu cita con ${businessName} para ${whenLabel(start)} a las ${formatTime(start)}. 🌳\n\n` +
    `¡Te esperamos!`
  );
}

export function buildReminder2h(businessName: string, name: string | undefined, start: Date, modality?: AppointmentModality): string {
  const first = friendlyFirstName(name);
  const hi    = first ? `¡Hola, ${first}! 👋` : '¡Hola! 👋';
  return (
    `${hi}\n\n` +
    `Tu cita con ${businessName} es hoy a las ${formatTime(start)}. ⏰\n\n` +
    (modality === 'videollamada'
      ? `Unos minutos antes te enviaremos el enlace de Google Meet para la videollamada. 😊`
      : `Tu asesor te llamará a este número. ¡Ten tu teléfono a la mano! 📞`)
  );
}

export function buildReminder30m(name: string | undefined, meetLink?: string, modality?: AppointmentModality): string {
  const first = friendlyFirstName(name);
  const who   = first ? `${first}, tu` : 'Tu';
  if (modality !== 'videollamada') {
    return (
      `📞 ¡${who} cita es en unos minutos!\n\n` +
      `Tu asesor te llamará a este número. ¡Ten tu teléfono a la mano! 😊`
    );
  }
  if (meetLink) {
    return (
      `🎥 ¡${who} cita es en unos minutos!\n\n` +
      `Conéctate a la videollamada de Google Meet aquí:\n${meetLink}\n\n` +
      `¡Te esperamos! 😊`
    );
  }
  return (
    `⏰ ¡${who} cita es en unos minutos!\n\n` +
    `En seguida tu asesor se comunicará contigo para conectarse. ¡Te esperamos! 😊`
  );
}

// ── Evento de Google Calendar (lo ve el cliente al unirse al Meet) ──────────
export function buildEventTitle(name?: string): string {
  return name && !name.startsWith('Lead ') ? `Cita con ${name}` : 'Cita';
}

export function buildEventDescription(businessName: string, name: string | undefined, fromAi: boolean): string {
  const who = name && !name.startsWith('Lead ') ? name : 'el cliente';
  const lines = [
    `Cita agendada para ${who} con ${businessName}.`,
  ];
  if (fromAi) lines.push('', '— Agendada automáticamente por nuestro asistente virtual. 🤖');
  return lines.join('\n');
}
