import { useEffect, type ReactNode } from 'react';
import { Alert } from 'react-native';
import messaging from '@react-native-firebase/messaging';
import notifee, { EventType } from '@notifee/react-native';
import firestore from '@react-native-firebase/firestore';
import { useAuth } from './AuthProvider';
import { displayRemoteNotification, requestAndRegisterPush } from '../services/notifications';
import { navigationRef } from '../navigation/navigationRef';
import { isAdminRole, type Lead, type UserRole } from '../types';

async function openLead(
  companyId: string,
  leadId?: string,
  currentUid?: string | null,
  role?: UserRole | null,
  platformAdmin?: boolean
) {
  if (!leadId || !navigationRef.isReady()) return;
  let snapshot;
  try {
    snapshot = await firestore()
      .collection('companies')
      .doc(companyId)
      .collection('leads')
      .doc(leadId)
      .get();
  } catch (err: any) {
    // Seguridad (R05): si el lead ya no es del asesor, las reglas niegan la lectura.
    if (err?.code === 'firestore/permission-denied') {
      Alert.alert('Prospecto reasignado', 'Este prospecto ya no está asignado a tu cuenta.');
      return;
    }
    throw err;
  }
  const exists = typeof snapshot.exists === 'function' ? snapshot.exists() : Boolean(snapshot.exists);
  if (!exists) return;

  const leadData = { id: snapshot.id, ...snapshot.data() } as Lead;
  const isAdmin = Boolean(platformAdmin) || isAdminRole(role);

  if (!isAdmin && leadData.assignedTo && currentUid && leadData.assignedTo !== currentUid) {
    const isTimeout = (leadData.advisorReassignmentCount ?? 0) > 0 || !!leadData.lastAutoReassignedAt;
    Alert.alert(
      'Prospecto reasignado',
      isTimeout
        ? 'Este prospecto fue reasignado automáticamente porque no se realizó el primer contacto dentro de los 5 minutos reglamentarios. Ya no se encuentra en tu bandeja.'
        : 'Este prospecto ya no está asignado a tu cuenta.'
    );
    return;
  }

  navigationRef.navigate('Chat', { lead: leadData, leadId: leadData.id });
}

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { companyId, user, profile, platformAdmin } = useAuth();

  useEffect(() => {
    if (!companyId || !user) return;
    requestAndRegisterPush(companyId).catch(console.warn);

    const tokenSubscription = messaging().onTokenRefresh(() => {
      requestAndRegisterPush(companyId).catch(console.warn);
    });
    const foregroundSubscription = messaging().onMessage(displayRemoteNotification);
    const openedSubscription = messaging().onNotificationOpenedApp((message) => {
      openLead(
        companyId,
        message.data?.leadId as string | undefined,
        user?.uid,
        profile?.role,
        platformAdmin
      ).catch(console.warn);
    });
    messaging()
      .getInitialNotification()
      .then((message) => {
        if (message) {
          openLead(
            companyId,
            message.data?.leadId as string | undefined,
            user?.uid,
            profile?.role,
            platformAdmin
          ).catch(console.warn);
        }
      });
    notifee
      .getInitialNotification()
      .then((initial) => {
        if (initial?.notification?.data?.leadId) {
          openLead(
            companyId,
            initial.notification.data.leadId as string,
            user?.uid,
            profile?.role,
            platformAdmin
          ).catch(console.warn);
        }
      })
      .catch(console.warn);
    const notifeeSubscription = notifee.onForegroundEvent(({ type, detail }) => {
      if (type === EventType.PRESS) {
        openLead(
          companyId,
          detail.notification?.data?.leadId as string | undefined,
          user?.uid,
          profile?.role,
          platformAdmin
        ).catch(console.warn);
      }
    });

    return () => {
      tokenSubscription();
      foregroundSubscription();
      openedSubscription();
      notifeeSubscription();
    };
  }, [companyId, user, profile, platformAdmin]);

  return children;
}
