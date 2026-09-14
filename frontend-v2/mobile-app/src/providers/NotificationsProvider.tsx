import { useEffect, type ReactNode } from 'react';
import messaging from '@react-native-firebase/messaging';
import notifee, { EventType } from '@notifee/react-native';
import firestore from '@react-native-firebase/firestore';
import { useAuth } from './AuthProvider';
import { displayRemoteNotification, requestAndRegisterPush } from '../services/notifications';
import { navigationRef } from '../navigation/navigationRef';
import type { Lead } from '../types';

async function openLead(companyId: string, leadId?: string) {
  if (!leadId || !navigationRef.isReady()) return;
  const snapshot = await firestore()
    .collection('companies').doc(companyId)
    .collection('leads').doc(leadId).get();
  if (snapshot.exists()) {
    navigationRef.navigate('Chat', { lead: { id: snapshot.id, ...snapshot.data() } as Lead });
  }
}

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { companyId, user } = useAuth();

  useEffect(() => {
    if (!companyId || !user) return;
    requestAndRegisterPush(companyId).catch(console.warn);

    const tokenSubscription = messaging().onTokenRefresh(() => {
      requestAndRegisterPush(companyId).catch(console.warn);
    });
    const foregroundSubscription = messaging().onMessage(displayRemoteNotification);
    const openedSubscription = messaging().onNotificationOpenedApp((message) => {
      openLead(companyId, message.data?.leadId as string | undefined).catch(console.warn);
    });
    messaging().getInitialNotification().then((message) => {
      if (message) openLead(companyId, message.data?.leadId as string | undefined).catch(console.warn);
    });
    const notifeeSubscription = notifee.onForegroundEvent(({ type, detail }) => {
      if (type === EventType.PRESS) {
        openLead(companyId, detail.notification?.data?.leadId as string | undefined).catch(console.warn);
      }
    });

    return () => {
      tokenSubscription();
      foregroundSubscription();
      openedSubscription();
      notifeeSubscription();
    };
  }, [companyId, user]);

  return children;
}
