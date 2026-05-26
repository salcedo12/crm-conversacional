import { google } from 'googleapis';

export class GoogleCalendarService {
  private calendar;

  constructor() {
    const auth = new google.auth.GoogleAuth({
      // En producción: configurar con Firebase Secret Manager
      // firebase functions:secrets:set GOOGLE_SA_KEY
      keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS,
      scopes: [
        'https://www.googleapis.com/auth/calendar',
        'https://www.googleapis.com/auth/calendar.events',
      ],
    });
    this.calendar = google.calendar({ version: 'v3', auth });
  }

  async createMeetEvent(
    title: string,
    description: string,
    emails: string[],
    startTime: Date,
    endTime: Date
  ): Promise<string | null> {
    try {
      if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        console.warn('[CALENDAR] Sin credenciales configuradas — retornando link mock.');
        return `https://meet.google.com/mock-${Date.now()}`;
      }

      const response = await this.calendar.events.insert({
        calendarId: 'primary',
        conferenceDataVersion: 1,
        requestBody: {
          summary: title,
          description,
          start: { dateTime: startTime.toISOString(), timeZone: 'America/Mexico_City' },
          end: { dateTime: endTime.toISOString(), timeZone: 'America/Mexico_City' },
          attendees: emails.map((email) => ({ email })),
          conferenceData: {
            createRequest: {
              requestId: `crm-meet-${Date.now()}`,
              conferenceSolutionKey: { type: 'hangoutsMeet' },
            },
          },
        },
      });

      return response.data.hangoutLink ?? null;
    } catch (error) {
      console.error('Error creando evento de calendario:', error);
      return null;
    }
  }
}
