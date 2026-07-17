import { Timestamp } from 'firebase-admin/firestore';

export interface GoogleConnection {
  companyId:    string;
  advisorId:    string;   // uid del asesor (Firebase Auth)
  email:        string;   // email de la cuenta de Google conectada
  refreshToken: string;   // token de larga duración para crear eventos
  scope:        string;
  status:       'connected' | 'disconnected';
  connectedAt:  Timestamp;
  updatedAt:    Timestamp;
}
