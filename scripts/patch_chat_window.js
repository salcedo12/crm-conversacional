const fs = require('fs');
const path = './frontend-v2/src/features/inbox/components/ChatWindow.tsx';
let content = fs.readFileSync(path, 'utf8');

// 1. Update imports
content = content.replace(
  "import { useEffect, useLayoutEffect, useRef, useState } from 'react';",
  "import { useEffect, useLayoutEffect, useRef, useState, useMemo } from 'react';"
);
content = content.replace(
  "import { AlertTriangle }        from 'lucide-react';",
  "import { AlertTriangle, ShieldAlert } from 'lucide-react';"
);

// 2. Add privacy wall logic
const targetHook = 'const { messages, loading, loadingMore, hasMore, loadMore } = useMessages(companyId, isAssignedToOther ? null : lead.id);';
const privacyLogic = `const { messages, loading, loadingMore, hasMore, loadMore } = useMessages(companyId, isAssignedToOther ? null : lead.id);

  // Muro de Privacidad de Chats en Reasignaciones (Protocolo Meraki)
  // Si el usuario es un asesor (no admin), y el lead fue reasignado, se ocultan los mensajes
  // anteriores a la reasignación para proteger la confidencialidad de la gestión previa.
  const isReassigned = !isAdmin && !!lead.advisorAssignedAt && (!!lead.previousAdvisorId || (lead.advisorReassignmentCount ?? 0) > 0);
  const cutoffTime = isReassigned && lead.advisorAssignedAt ? lead.advisorAssignedAt.toMillis() : 0;

  const { visibleMessages, hiddenCount } = useMemo(() => {
    if (!cutoffTime) return { visibleMessages: messages, hiddenCount: 0 };
    const visible: Message[] = [];
    let hidden = 0;
    for (const msg of messages) {
      const msgMillis = msg.createdAt
        ? (typeof msg.createdAt.toMillis === 'function'
            ? msg.createdAt.toMillis()
            : (msg.createdAt.seconds ? msg.createdAt.seconds * 1000 : 0))
        : 0;
      if (msgMillis >= cutoffTime) {
        visible.push(msg);
      } else {
        hidden++;
      }
    }
    return { visibleMessages: visible, hiddenCount: hidden };
  }, [messages, cutoffTime]);`;

content = content.replace(targetHook, privacyLogic);

// 3. Update scroll effect dependency to visibleMessages
content = content.replace('}, [messages]);', '}, [visibleMessages]);');

// 4. Update message list rendering
content = content.replace(
  '{!loading && messages.length === 0 && (',
  `{hiddenCount > 0 && (
          <div className="my-4 mx-auto max-w-md p-3.5 bg-zinc-900/90 border border-zinc-800 rounded-2xl text-center shadow-lg">
            <div className="flex items-center justify-center gap-1.5 text-violet-400 font-medium text-xs mb-1">
              <ShieldAlert className="w-4 h-4 shrink-0" />
              <span>Gestión previa protegida por confidencialidad</span>
            </div>
            <p className="text-[11px] text-zinc-400 leading-relaxed">
              {hiddenCount} mensaje(s) de gestiones anteriores están reservados por política de privacidad. 
              Revisa la <strong>Ficha Técnica</strong> y el <strong>Resumen IA</strong> para conocer todos los antecedentes y acuerdos del cliente.
            </p>
          </div>
        )}

        {!loading && visibleMessages.length === 0 && (`
);

content = content.replace(
  '{messages.map((msg) => (',
  '{visibleMessages.map((msg) => ('
);

fs.writeFileSync(path, content, 'utf8');
console.log('ChatWindow.tsx successfully patched!');
