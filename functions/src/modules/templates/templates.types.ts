import { Timestamp } from 'firebase-admin/firestore';

export type TemplateCategory = 'marketing' | 'utility' | 'authentication';
export type TemplateStatus   = 'approved' | 'pending' | 'rejected' | 'local';

/** Tipo de cabecera de la plantilla */
export type TemplateHeaderType = 'none' | 'text' | 'image' | 'video' | 'document';

/** Tipo de botón soportado */
export type TemplateButtonType = 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER' | 'COPY_CODE';

export interface TemplateButton {
  type:         TemplateButtonType;
  text:         string;   // etiqueta del botón (no aplica para COPY_CODE)
  url?:         string;   // requerido para URL
  phoneNumber?: string;   // requerido para PHONE_NUMBER
}

export interface TemplateVariable {
  key:     string;  // nombre descriptivo, ej: "nombre", "fecha"
  example: string;  // valor de ejemplo para preview
}

export interface WhatsAppTemplate {
  id:          string;
  companyId:   string;
  name:        string;          // nombre interno, ej: "reactivacion_lead"
  displayName: string;          // nombre visible en UI
  category:    TemplateCategory;
  language:    string;          // "es" | "es_CO" | "en_US"
  header?:     string;          // texto de cabecera (cuando headerType === 'text')
  headerType?: TemplateHeaderType;  // tipo de cabecera; default 'text' si hay header, si no 'none'
  headerMediaUrl?: string;      // URL de muestra del media para headerType image/video/document
  headerMediaFilename?: string; // nombre de archivo (para documentos: título mostrado en WhatsApp)
  body:        string;          // cuerpo con {{nombre}}, {{fecha}}, etc.
  footer?:     string;          // texto de pie opcional
  buttons?:    TemplateButton[];
  variables:   TemplateVariable[];
  /** SID del Content API de Twilio (si fue sincronizado desde Meta/Twilio) */
  twilioContentSid?: string;
  status:      TemplateStatus;
  createdAt:   Timestamp;
  updatedAt?:  Timestamp;
}

export type CreateTemplateInput = Omit<WhatsAppTemplate, 'id' | 'createdAt' | 'updatedAt'>;
export type UpdateTemplateInput = Partial<Omit<WhatsAppTemplate, 'id' | 'companyId' | 'createdAt'>>;
