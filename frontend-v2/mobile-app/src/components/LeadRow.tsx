import { Pressable, Text, View } from 'react-native';
import { isUnread, shortTime } from '../utils/format';
import { isDirectAdvisorLead, ADVISOR_WHATSAPP_LABEL } from '../utils/leadClassification';
import type { Lead } from '../types';

export function LeadRow({ lead, userId, onPress }: { lead: Lead; userId: string; onPress: () => void }) {
  const unread = isUnread(lead.lastInboundAt, lead.readBy?.[userId]);
  const displayName = lead.name || lead.phone || 'Sin nombre';
  const preview = lead.lastMessageText || 'Conversación nueva';

  // Extract flag from phone
  const getFlag = (phone: string) => {
    if (!phone) return '🏳️';
    if (phone.startsWith('+57') || phone.startsWith('57')) return '🇨🇴';
    if (phone.startsWith('+52') || phone.startsWith('52')) return '🇲🇽';
    if (phone.startsWith('+56') || phone.startsWith('56')) return '🇨🇱';
    if (phone.startsWith('+54') || phone.startsWith('54')) return '🇦🇷';
    if (phone.startsWith('+51') || phone.startsWith('51')) return '🇵🇪';
    if (phone.startsWith('+34') || phone.startsWith('34')) return '🇪🇸';
    if (phone.startsWith('+1') || phone.startsWith('1')) return '🇺🇸';
    return '🏳️';
  };

  const isAdvisorWhatsapp = isDirectAdvisorLead(lead);
  const isWhatsapp = !isAdvisorWhatsapp && (lead.source === 'whatsapp' || lead.channel === 'whatsapp');
  const isForm = lead.source === 'form' || lead.source === 'Formulario';

  return (
    <Pressable
      onPress={onPress}
      className={`w-full px-4 py-3 border-b border-zinc-800/60 active:bg-zinc-800/50 ${
        unread ? 'bg-violet-500/10' : 'bg-surface'
      }`}
    >
      <View className="flex-row items-start justify-between gap-2 mb-1">
        <Text
          numberOfLines={1}
          className={`flex-1 text-sm ${
            unread ? 'font-semibold text-white' : 'font-medium text-zinc-100'
          }`}
        >
          {getFlag(lead.phone)} {displayName}
        </Text>
        <Text
          className={`shrink-0 text-[10px] ${
            unread ? 'font-medium text-violet-300' : 'text-zinc-500'
          }`}
        >
          {shortTime(lead.lastMessageAt)}
        </Text>
      </View>

      <View className="flex-row items-center gap-2 mb-1.5">
        {unread && <View className="h-2 w-2 shrink-0 rounded-full bg-violet-400" />}
        <Text
          numberOfLines={1}
          className={`flex-1 text-xs ${
            unread ? 'font-medium text-zinc-200' : 'text-zinc-400'
          }`}
        >
          {preview}
        </Text>
      </View>

      <View className="flex-row flex-wrap items-center gap-1.5">
        {/* Status Badge */}
        <View
          className={`h-6 rounded-full px-2 flex-row items-center gap-1.5 border ${
            lead.aiEnabled
              ? 'bg-amber-500/10 border-amber-500/30'
              : 'bg-zinc-800 border-zinc-700'
          }`}
        >
          <View
            className={`w-1.5 h-1.5 rounded-full ${
              lead.aiEnabled ? 'bg-amber-500' : 'bg-zinc-500'
            }`}
          />
          <Text
            className={`text-[10px] font-medium ${
              lead.aiEnabled ? 'text-amber-500' : 'text-zinc-400'
            }`}
          >
            {lead.aiEnabled ? 'IA activa' : 'Modo manual'}
          </Text>
        </View>

        {/* Channel Badge */}
        <View className="h-6 rounded-full px-2 flex-row items-center gap-1.5 border bg-zinc-800/50 border-zinc-800">
          {isAdvisorWhatsapp ? (
            <>
              <View className="w-1.5 h-1.5 rounded-full bg-amber-400" />
              <Text className="text-[10px] font-medium text-zinc-400">{ADVISOR_WHATSAPP_LABEL}</Text>
            </>
          ) : isWhatsapp ? (
            <>
              <View className="w-1.5 h-1.5 rounded-full bg-[#25D366]" />
              <Text className="text-[10px] font-medium text-zinc-400">WhatsApp</Text>
            </>
          ) : isForm ? (
            <>
              <Text className="text-[10px]">📋</Text>
              <Text className="text-[10px] font-medium text-zinc-400">Formulario</Text>
            </>
          ) : (
            <>
              <View className="w-1.5 h-1.5 rounded-full bg-blue-500" />
              <Text className="text-[10px] font-medium text-zinc-400 capitalize">
                {lead.source || 'Facebook'}
              </Text>
            </>
          )}
        </View>

        {lead.status === 'scheduled' && (
          <View className="h-6 rounded-full px-2 flex-row items-center border bg-[#2E2305] border-[#6E5204]">
            <Text className="text-[10px] font-medium text-amber-500">Agendado</Text>
          </View>
        )}
      </View>
    </Pressable>
  );
}
