/** Payload que Twilio envía via form-urlencoded en el webhook */
export interface TwilioWebhookPayload {
  MessageSid:   string;
  From:         string;   // "whatsapp:+573213443603"
  To:           string;   // "whatsapp:+14155238886"
  Body:         string;
  ProfileName?: string;
  NumMedia?:    string;
  AccountSid?:  string;
  SmsSid?:      string;
}
