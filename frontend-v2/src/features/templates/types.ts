export type TemplateCategory = 'marketing' | 'utility' | 'authentication';
export type TemplateStatus   = 'approved' | 'pending' | 'rejected' | 'local';
export type TemplateHeaderType = 'none' | 'text' | 'image' | 'video' | 'document';
export type TemplateButtonType = 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER' | 'COPY_CODE';

export interface TemplateButton {
  type:         TemplateButtonType;
  text:         string;
  url?:         string;
  phoneNumber?: string;
}

export interface TemplateVariable {
  key:     string;
  example: string;
}

export interface WhatsAppTemplate {
  id:              string;
  companyId:       string;
  name:            string;
  displayName:     string;
  category:        TemplateCategory;
  language:        string;
  header?:         string;
  headerType?:     TemplateHeaderType;
  headerMediaUrl?: string;
  headerMediaFilename?: string;
  body:            string;
  footer?:         string;
  buttons?:        TemplateButton[];
  variables:       TemplateVariable[];
  twilioContentSid?: string;
  status:          TemplateStatus;
  createdAt:       { toMillis(): number } | null;
  updatedAt?:      { toMillis(): number } | null;
}

export type CreateTemplateInput = Omit<WhatsAppTemplate, 'id' | 'createdAt' | 'updatedAt'>;
