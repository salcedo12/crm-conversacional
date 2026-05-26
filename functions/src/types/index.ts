import { Timestamp } from 'firebase-admin/firestore';

export type Role = 'ADMIN' | 'ADVISER';
export type LeadStatus = 'NEW' | 'QUALIFYING' | 'APPOINTMENT_SET' | 'WON' | 'LOST';
export type ConversationStatus = 'ACTIVE' | 'CLOSED';
export type SenderType = 'LEAD' | 'ADVISER' | 'AI' | 'SYSTEM';
export type AppointmentStatus = 'SCHEDULED' | 'CANCELED' | 'COMPLETED';

export interface Company {
  id: string;
  name: string;
  whatsappPhoneId?: string;
  whatsappToken?: string;
  settings?: Record<string, unknown>;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface User {
  id: string;
  companyId: string;
  name: string;
  email: string;
  role: Role;
  status: 'ACTIVE' | 'INACTIVE';
  assignedLeadsCount: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface Lead {
  id: string;
  companyId: string;
  phoneNumber: string;
  name?: string;
  status: LeadStatus;
  assignedToId?: string;
  activeConversationId?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface Conversation {
  id: string;
  leadId: string;
  companyId: string;
  status: ConversationStatus;
  aiActive: boolean;
  lastMessageText?: string;
  lastMessageAt?: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface Message {
  id: string;
  conversationId: string;
  senderType: SenderType;
  content: string;
  timestamp: Timestamp;
  metaMessageId?: string;
}

export interface Appointment {
  id: string;
  leadId: string;
  adviserId: string;
  companyId: string;
  title: string;
  startTime: Timestamp;
  endTime: Timestamp;
  googleMeetLink?: string;
  status: AppointmentStatus;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface PromptConfig {
  id: string;
  companyId: string;
  behaviorInstructions: string;
  knowledgeBase?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
