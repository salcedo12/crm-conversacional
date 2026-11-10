import { useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import firestore from '@react-native-firebase/firestore';
import { useAuth } from '../providers/AuthProvider';
import { useTheme } from '../providers/ThemeProvider';
import { rejectWhatsappCall } from '../services/enterprise';
import { navigationRef } from '../navigation/navigationRef';
import { formatPhone } from '../utils/formatPhone';
import { Icon } from './Icon';

interface RingingCallDoc {
  id: string;
  leadId: string;
  leadName?: string;
  leadPhone?: string;
  assignedTo?: string | null;
}

export function CallOverlay() {
  const insets = useSafeAreaInsets();
  const { palette } = useTheme();
  const { user, companyId, isAdmin } = useAuth();
  const [ringingCalls, setRingingCalls] = useState<RingingCallDoc[]>([]);
  const [rejectingId, setRejectingId] = useState<string | null>(null);

  useEffect(() => {
    if (!companyId) {
      setRingingCalls([]);
      return;
    }

    const unsub = firestore()
      .collectionGroup('calls')
      .where('companyId', '==', companyId)
      .where('status', '==', 'ringing')
      .onSnapshot(
        (snap) => {
          const all: RingingCallDoc[] = snap.docs.map((d) => {
            const data = d.data() || {};
            const pathParts = d.ref.path.split('/');
            const leadIdx = pathParts.indexOf('leads');
            const leadId = data.leadId || (leadIdx >= 0 ? pathParts[leadIdx + 1] : '');
            return {
              id: d.id,
              leadId,
              leadName: data.leadName,
              leadPhone: data.leadPhone,
              assignedTo: data.assignedTo,
            };
          });
          setRingingCalls(all.filter((c) => isAdmin || !c.assignedTo || c.assignedTo === user?.uid));
        },
        () => {}
      );

    return () => unsub();
  }, [companyId, user?.uid, isAdmin]);

  const incomingCall = ringingCalls[0];
  if (!companyId || !incomingCall) return null;

  const handleReject = async () => {
    setRejectingId(incomingCall.id);
    try {
      await rejectWhatsappCall(companyId, incomingCall.leadId, incomingCall.id);
    } catch {}
    setRejectingId(null);
  };

  const handleOpenOrCall = () => {
    if (navigationRef.isReady() && incomingCall.leadId) {
      navigationRef.navigate('Chat', { leadId: incomingCall.leadId });
    } else if (incomingCall.leadPhone) {
      void Linking.openURL(`tel:${incomingCall.leadPhone}`);
    }
  };

  return (
    <View style={[styles.wrapper, { top: Math.max(insets.top + 8, 16) }]} pointerEvents="box-none">
      <View
        style={[
          styles.banner,
          {
            backgroundColor: palette.bgCard,
            borderColor: palette.emeraldBorder,
          },
        ]}
      >
        <View style={[styles.pulseCircle, { backgroundColor: palette.emeraldBg }]}>
          <Icon name="PhoneIncoming" size={18} color={palette.emerald} />
        </View>
        <Pressable onPress={handleOpenOrCall} style={{ flex: 1 }}>
          <Text style={[styles.name, { color: palette.textPrimary }]} numberOfLines={1}>
            {incomingCall.leadName || formatPhone(incomingCall.leadPhone || '')}
          </Text>
          <Text style={{ fontSize: 11, color: palette.textMuted }}>Llamada de WhatsApp entrante</Text>
        </Pressable>
        <Pressable
          onPress={handleReject}
          disabled={rejectingId === incomingCall.id}
          style={[styles.roundBtn, { backgroundColor: palette.roseBg }]}
        >
          <Icon name="PhoneOff" size={16} color={palette.rose} />
        </Pressable>
        <Pressable
          onPress={handleOpenOrCall}
          style={[styles.roundBtn, { backgroundColor: palette.emeraldBg }]}
        >
          <Icon name="MessageSquare" size={16} color={palette.emerald} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    left: 14,
    right: 14,
    zIndex: 200,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 16,
    borderWidth: 1,
    elevation: 8,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  pulseCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: { fontSize: 13, fontWeight: '700' },
  roundBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
