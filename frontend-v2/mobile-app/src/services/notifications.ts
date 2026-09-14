import { Platform } from 'react-native';
import messaging, { type FirebaseMessagingTypes } from '@react-native-firebase/messaging';
import { getFunctions, httpsCallable } from '@react-native-firebase/functions';
import notifee, { AndroidImportance, AuthorizationStatus, TriggerType, type TimestampTrigger } from '@notifee/react-native';

export const MESSAGE_CHANNEL = 'mensajes';
export const REMINDER_CHANNEL = 'recordatorios';

export async function ensureNotificationChannel() {
  if (Platform.OS !== 'android') return;
  await notifee.createChannel({
    id: MESSAGE_CHANNEL,
    name: 'Mensajes de clientes',
    description: 'Mensajes nuevos y leads asignados',
    importance: AndroidImportance.HIGH,
    sound: 'default',
    vibration: true,
    lights: true,
    badge: true,
  });
  await notifee.createChannel({
    id: REMINDER_CHANNEL,
    name: 'Recordatorios',
    description: 'Recordatorios manuales de seguimiento',
    importance: AndroidImportance.HIGH,
    sound: 'default',
    vibration: true,
    lights: true,
    badge: true,
  });
}

export async function requestAndRegisterPush(companyId: string) {
  await ensureNotificationChannel();
  await notifee.requestPermission();
  await messaging().registerDeviceForRemoteMessages();
  await messaging().requestPermission();
  const token = await messaging().getToken();
  const registerPushToken = httpsCallable(getFunctions(undefined, 'us-central1'), 'registerPushToken');
  await registerPushToken({
    companyId,
    token,
    platform: Platform.OS === 'android' ? 'android-native' : 'ios-native',
  });
  return token;
}

export async function scheduleLeadReminderNotification(input: {
  noteId: string;
  companyId: string;
  leadId: string;
  leadName: string;
  text: string;
  dueAt: number;
}): Promise<boolean> {
  if (input.dueAt <= Date.now()) return false;
  await ensureNotificationChannel();
  const settings = await notifee.requestPermission();
  if (settings.authorizationStatus === AuthorizationStatus.DENIED) return false;
  const trigger: TimestampTrigger = {
    type: TriggerType.TIMESTAMP,
    timestamp: input.dueAt,
  };
  await notifee.createTriggerNotification(
    {
      id: `lead-reminder-${input.noteId}`,
      title: `Recordatorio: ${input.leadName}`,
      body: input.text,
      data: { companyId: input.companyId, leadId: input.leadId, type: 'reminder', noteId: input.noteId },
      android: {
        channelId: REMINDER_CHANNEL,
        importance: AndroidImportance.HIGH,
        pressAction: { id: 'open-crm', launchActivity: 'default' },
        smallIcon: 'ic_launcher',
        sound: 'default',
      },
      ios: { sound: 'default' },
    },
    trigger
  );
  return true;
}

export async function cancelLeadReminderNotification(noteId: string) {
  await notifee.cancelNotification(`lead-reminder-${noteId}`);
}

export async function displayRemoteNotification(message: FirebaseMessagingTypes.RemoteMessage) {
  await ensureNotificationChannel();
  const title = message.notification?.title ?? message.data?.title ?? 'Meraki CRM';
  const body = message.notification?.body ?? message.data?.body ?? 'Tienes una novedad';
  await notifee.displayNotification({
    title: String(title),
    body: String(body),
    data: message.data,
    android: {
      channelId: MESSAGE_CHANNEL,
      importance: AndroidImportance.HIGH,
      pressAction: { id: 'open-crm', launchActivity: 'default' },
      smallIcon: 'ic_launcher',
      sound: 'default',
    },
    ios: { sound: 'default', foregroundPresentationOptions: { banner: true, list: true, sound: true, badge: true } },
  });
}
