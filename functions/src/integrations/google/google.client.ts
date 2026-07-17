import { env } from '../../config/env';
import { logger } from '../../utils/logger';

// `googleapis` es una librería pesada: se carga de forma lazy para no exceder el
// timeout de análisis del backend en el deploy de Cloud Functions.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function gapi(): any {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('googleapis').google;
}

const SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.readonly',
  'openid',
  'email',
  'profile',
];

/** Construye un cliente OAuth2 con las credenciales de la app. */
export function buildOAuthClient() {
  return new (gapi().auth.OAuth2)(
    env.googleClientId(),
    env.googleClientSecret(),
    env.googleOAuthRedirect()
  );
}

/** Genera la URL de consentimiento de Google. `state` viaja de ida y vuelta. */
export function getConsentUrl(state: string): string {
  return buildOAuthClient().generateAuthUrl({
    access_type: 'offline',      // necesario para obtener refresh_token
    prompt:      'consent',       // fuerza refresh_token incluso si ya autorizó antes
    scope:       SCOPES,
    state,
  });
}

export interface ExchangeResult {
  refreshToken: string;
  email:        string;
  scope:        string;
}

/** Intercambia el `code` por tokens y obtiene el email de la cuenta. */
export async function exchangeCode(code: string): Promise<ExchangeResult> {
  const client = buildOAuthClient();
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);

  if (!tokens.refresh_token) {
    throw new Error('Google no devolvió refresh_token. Revoca el acceso y vuelve a conectar con prompt=consent.');
  }

  // Obtener email del usuario conectado
  const oauth2 = gapi().oauth2({ version: 'v2', auth: client });
  const { data } = await oauth2.userinfo.get();

  return {
    refreshToken: tokens.refresh_token,
    email:        data.email ?? '',
    scope:        tokens.scope ?? SCOPES.join(' '),
  };
}

export interface CreateEventInput {
  title:       string;
  description: string;
  attendees:   string[];     // emails
  start:       Date;
  end:         Date;
  withMeet?:   boolean;       // default true
}

export interface CreateEventResult {
  eventId:   string | null;
  meetLink:  string | null;
  htmlLink:  string | null;
}

/**
 * Crea un evento en el calendario primario de la cuenta dueña del refreshToken,
 * con un enlace de Google Meet único.
 */
export async function createMeetEvent(
  refreshToken: string,
  input:        CreateEventInput
): Promise<CreateEventResult> {
  const client = buildOAuthClient();
  client.setCredentials({ refresh_token: refreshToken });
  const calendar = gapi().calendar({ version: 'v3', auth: client });

  const tz = env.calendarTimeZone();
  const withMeet = input.withMeet !== false;
  const res = await calendar.events.insert({
    calendarId:            'primary',
    conferenceDataVersion: withMeet ? 1 : 0,
    sendUpdates:           'all',
    requestBody: {
      summary:     input.title,
      description: input.description,
      start:       { dateTime: input.start.toISOString(), timeZone: tz },
      end:         { dateTime: input.end.toISOString(),   timeZone: tz },
      attendees:   input.attendees.filter(Boolean).map((email) => ({ email })),
      ...(withMeet ? {
        conferenceData: {
          createRequest: {
            requestId:             `crm-meet-${Date.now()}`,
            conferenceSolutionKey: { type: 'hangoutsMeet' },
          },
        },
      } : {}),
    },
  });

  logger.info('[Google] Evento creado', { eventId: res.data.id, meet: res.data.hangoutLink });
  return {
    eventId:  res.data.id ?? null,
    meetLink: res.data.hangoutLink ?? null,
    htmlLink: res.data.htmlLink ?? null,
  };
}

export interface GoogleEventDTO {
  id:       string;
  title:    string;
  start:    number;  // millis
  end:      number;  // millis
  allDay:   boolean;
  meetLink: string | null;
  htmlLink: string | null;
}

/** Lista los eventos del calendario primario en un rango. */
export async function listEvents(
  refreshToken: string,
  timeMin:      Date,
  timeMax:      Date
): Promise<GoogleEventDTO[]> {
  const client = buildOAuthClient();
  client.setCredentials({ refresh_token: refreshToken });
  const calendar = gapi().calendar({ version: 'v3', auth: client });

  const res = await calendar.events.list({
    calendarId:   'primary',
    timeMin:      timeMin.toISOString(),
    timeMax:      timeMax.toISOString(),
    singleEvents: true,
    orderBy:      'startTime',
    maxResults:   250,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (res.data.items ?? []).map((ev: any): GoogleEventDTO => {
    const startRaw = ev.start?.dateTime ?? ev.start?.date;
    const endRaw   = ev.end?.dateTime   ?? ev.end?.date;
    return {
      id:       ev.id ?? '',
      title:    ev.summary ?? '(sin título)',
      start:    startRaw ? new Date(startRaw).getTime() : 0,
      end:      endRaw   ? new Date(endRaw).getTime()   : 0,
      allDay:   !ev.start?.dateTime,
      meetLink: ev.hangoutLink ?? null,
      htmlLink: ev.htmlLink ?? null,
    };
  });
}

/** Elimina un evento del calendario primario. */
export async function deleteEvent(refreshToken: string, eventId: string): Promise<void> {
  const client = buildOAuthClient();
  client.setCredentials({ refresh_token: refreshToken });
  const calendar = gapi().calendar({ version: 'v3', auth: client });
  await calendar.events.delete({ calendarId: 'primary', eventId, sendUpdates: 'all' });
}
