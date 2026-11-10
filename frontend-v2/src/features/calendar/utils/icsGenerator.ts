/**
 * Genera y descarga un archivo .ics estándar para agregar eventos con alarmas
 * en cualquier calendario (Google Calendar, Apple Calendar en iPhone, Outlook, Android).
 */
export function downloadIcsFile(event: {
  title: string;
  description: string;
  location?: string;
  startDate: Date;
  durationMinutes: number;
}) {
  const pad = (n: number) => (n < 10 ? '0' + n : String(n));
  const toIcsDate = (d: Date) =>
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;

  const endDate = new Date(event.startDate.getTime() + event.durationMinutes * 60_000);
  const now = new Date();

  const icsContent = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Meraki CRM//Agenda Comercial//ES',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:meraki-${Date.now()}@merakicrm.com`,
    `DTSTAMP:${toIcsDate(now)}`,
    `DTSTART:${toIcsDate(event.startDate)}`,
    `DTEND:${toIcsDate(endDate)}`,
    `SUMMARY:${event.title.replace(/\n/g, ' ')}`,
    `DESCRIPTION:${event.description.replace(/\n/g, '\\n')}`,
    event.location ? `LOCATION:${event.location.replace(/\n/g, ' ')}` : '',
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'DESCRIPTION:Recordatorio de cita comercial Meraki',
    'TRIGGER:-PT30M',
    'END:VALARM',
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'DESCRIPTION:Recordatorio 10 minutos',
    'TRIGGER:-PT10M',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean).join('\r\n');

  const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `evento_${Date.now()}.ics`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
