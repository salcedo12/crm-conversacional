import type { Timestamp } from 'firebase/firestore';

/** Un archivo reutilizable de la empresa (portafolio) guardado en la biblioteca. */
export interface LibraryItem {
  id:            string;
  companyId:     string;
  kind?:          'document' | 'video';
  visibility?:    'general' | 'advisor';
  advisorId?:     string;
  advisorName?:   string;
  project?:      string;   // proyecto / club de campo, p. ej. "Río Claro"
  title:         string;   // nombre visible, p. ej. "Portafolio Melgar"
  fileName:      string;   // nombre original del archivo
  storagePath:   string;   // ruta en Storage (para borrar)
  downloadUrl:   string;   // URL permanente que se envía a WhatsApp
  contentType:   string;   // p. ej. application/pdf
  sizeBytes:     number;
  createdBy?:    string;
  createdByName?: string;
  createdAt?:    Timestamp;
  updatedAt?:    Timestamp;
}
