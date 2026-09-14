# Handoff — Envío automático de planos por la IA (Victoria)

Fecha: 2026-08-12 · Autor de la tanda: sesión de pair-programming con Claude Code

## Objetivo

Que la asistente IA (Victoria Sarmiento) envíe **sola** el PDF del plano de
disponibilidad del club/etapa que le interesa al lead, justo después de mostrar las
amenidades, y luego lo guíe a agendar una llamada con un agente — sin intervención de un
asesor humano.

---

## 1. Qué se construyó

### Herramienta `enviar_plano` (OpenAI function calling)
Se agregó al orquestador de IA, siguiendo el mismo patrón que `agendar_cita`.
Cuando el lead muestra interés tras las amenidades, el modelo llama la tool con
`{ club, etapa? }` y el backend:

1. Consulta el índice de planos (endpoint `planosIndex`, ver §4).
2. Empareja club/etapa con `matchPlano` (normaliza acentos, mayúsculas, nombres largos).
3. Envía **en orden**: (1) texto de intro, (2) el PDF por WhatsApp, (3) la pregunta
   "¿En cuál terreno y sector está interesado?".

### Archivos nuevos
- `functions/src/modules/planos/planos.service.ts` — fetch del índice (cache 5 min),
  `matchPlano` (devuelve `ok` | `need_stage` | `not_found`), `planoFileName`, `planoLabel`.
- `functions/src/modules/planos/planos.service.test.ts` — 6 tests del matcher (incluye
  caso Laguna Mar → pide etapa).

### Archivos modificados
- `functions/src/modules/ai/aiOrchestrator.service.ts`:
  - Import de `sendMediaToLeadChannel` y del `planos.service`.
  - Nueva tool `enviar_plano` en el array de tools (junto a agendar/reagendar/cancelar).
  - Constantes `PLANO_INTRO` y `PLANO_QUESTION`.
  - Función `runPlanoTool(...)` (envía intro + PDF + registra el mensaje; devuelve
    `confirmationMessage` = la pregunta de cierre).
  - Dispatch en el loop de `toolCalls`: si `name === 'enviar_plano'` → `runPlanoTool`,
    si no → `runAppointmentTool`.
  - Dos `messages.push({ role: 'system', ... })` con las instrucciones de comportamiento
    (cuándo enviar el plano, no reenviar, ofrecer agendar, no inventar fecha/hora).
- `functions/src/config/env.ts`: nueva `planosIndexUrl()` (env var `PLANOS_INDEX_URL`,
  con default al endpoint de producción).
- `functions/src/http/ycloudWebhook.function.ts`: **bugfix** en `processYcloudMessageUpdate`
  (ver §5, "Pendiente de desplegar").

---

## 2. Flujo de conversación esperado

1. Amenidades → Victoria pregunta si quiere ver el plano.
2. Lead acepta → **envía el plano** (intro + PDF) → pregunta "¿en cuál terreno y sector?" →
   **espera**.
3. Lead menciona un terreno ("me gusta el 71") → **NO** reenvía el plano, **NO** pide datos
   de golpe: primero **OFRECE** agendar una llamada con un agente ("para info completa y
   cotización, ¿la agendamos?").
4. Si el lead acepta → pide los datos **uno por uno** (número de contacto → confirmarlo →
   fecha → hora) y **solo entonces** llama `agendar_cita`. Nunca inventa fecha/hora.

### Guardas implementadas (deterministas, no dependen solo del prompt)
- **Anti-reenvío**: `runPlanoTool` lee `messagesRepository.getRecent(30)` y si ya existe un
  mensaje con `metadata.origin === 'ai_plano'` y el mismo `planoId`, **no reenvía** y le
  indica al modelo que ofrezca agendar.
- **Laguna Mar / etapas**: si el lead elige Laguna Mar sin etapa, `matchPlano` devuelve
  `need_stage` y la IA pregunta "¿Mar Santorini o Mar Canarias?" antes de enviar.
- **Marca del mensaje**: el PDF se guarda como `senderType:'ai'`, `mediaKind:'document'`,
  `metadata.origin:'ai_plano'`, `metadata.planoId:<id>`.

---

## 3. Función desplegada

Todo el motor de IA corre en la Cloud Function **`onMessageCreated`** (trigger de Firestore
en `functions/src/triggers/messageCreated.trigger.ts`), codebase `crm-api`.

**Comando de deploy** (PowerShell, Windows):
```
$env:FUNCTIONS_DISCOVERY_TIMEOUT=120; firebase deploy --only functions:crm-api:onMessageCreated --project crm-conversacional
```
Notas de deploy (ver también memoria `crm-deploy-flow`):
- Usar `firebase` directo (NO `npx firebase`).
- El codebase es `crm-api` → filtros `functions:crm-api:<nombre>`.
- `FUNCTIONS_DISCOVERY_TIMEOUT=120` evita el timeout de análisis de 10s.
- El prompt de Victoria vive en **Firestore** (`companies/{companyId}/aiConfigs/default.basePrompt`),
  se lee fresco en cada mensaje → **cambiar el prompt NO requiere deploy**.

---

## 4. Índice de planos (dependencia externa)

- Endpoint: `https://us-central1-disponibilidad-e8a81.cloudfunctions.net/planosIndex`
  (proyecto **disponibilidad-e8a81** / tour-meraki, es OTRO proyecto Firebase).
- Devuelve `{ planos: [{ planoId, projectId, projectName, stageName, name, url, generatedAt }] }`.
- Hoy trae 6: Cañón de Arizona, Llano Grande, Río Claro, Sobre Montañas, y **Laguna Mar con
  2 etapas** (Mar Santorini, Mar Canarias). Los PDFs se regeneran solos al cambiar inventario.
- Es el MISMO índice que consume la Bandeja del frontend
  (`frontend-v2/src/features/library/services/planos.service.ts`).
- Override: env var `PLANOS_INDEX_URL`.

---

## 5. Estado / pendientes

### ✅ Hecho y desplegado
- Tool `enviar_plano` + guardas (anti-reenvío, etapas, no-auto-agendar, oferta natural).
- Tests 6/6, suite completa 56/56, typecheck limpio.
- **Fix de precio**: el `basePrompt` de `empresa_demo` tenía `$82.990.000`; se reemplazó por
  la versión con `$129.990.000` (dato en Firestore, ya en vivo).

### ⏳ Pendiente de desplegar (código listo, sin deploy — esperando decisión del dueño)
- **Bugfix webhook YCloud** en `ycloudWebhook.function.ts` → `processYcloudMessageUpdate`:
  `update.to.startsWith(...)` reventaba cuando los eventos `whatsapp.message.updated` de
  solo-estado (sent/delivered/read) no traen `to` → "Cannot read properties of undefined".
  Efectos del bug: disparaba alertas de error por WhatsApp y **rompía el tracking de entrega
  de difusiones** (crasheaba antes de `updateBroadcastDeliveryStatus`). Fix: mover el update
  de estado primero y guardar `if (!update.to || !esMedia) return;`. **Falta**:
  ```
  $env:FUNCTIONS_DISCOVERY_TIMEOUT=120; firebase deploy --only functions:crm-api:ycloudWebhook --project crm-conversacional
  ```

### ⚠️ Contexto importante de empresas / números
- Los mensajes de WhatsApp entrantes se enrutan por la colección `channelRoutes`
  (`resolveCompanyIdForChannel`). Sin ruta → cae a `DEFAULT_COMPANY_ID` = **`empresa_demo`**.
- **`empresa_demo`**: IA **ENCENDIDA**. Número que enruta aquí (sin ruta explícita):
  **+57 314 820 9662** (`YCLOUD_FROM_NUMBER`). Es la empresa demo — se usa para pruebas.
- **`grupo_meraki_real`** (producción real): IA **APAGADA** (`aiConfigs/default.enabled=false`).
  Rutas activas en `channelRoutes`: `ycloud_573176820728` (+57 317 682 0728), un WABA phone id
  y una página de Meta. **Victoria NO responde a clientes reales hasta que se encienda la IA
  de esta empresa.** No se tocó por decisión del dueño ("nada en producción aún").
- Hay servicio de alerta de errores que **manda las excepciones al WhatsApp** configurado
  (`ERROR_ALERT_PHONE`); por eso aparecían "Alertas del CRM" en el chat de prueba.

### Ideas / posible limpieza futura
- El `basePrompt` de Victoria (secciones 14–17 en el doc del cliente) todavía trae el texto
  manual de "Le envío el plano… ¿en cuál **lote** y sector del **proyecto**?" que ahora hace
  la tool. La tool ya usa "terreno" y no dice "proyecto"; conviene alinear el prompt para
  evitar que el modelo escriba el texto viejo. Reglas #12/#14 del prompt prohíben "lote"/"proyecto".
- Cuando se quiera activar en producción: encender IA de `grupo_meraki_real`, verificar
  `channelRoutes`, y desplegar el fix del webhook.

---

## 6. Cómo probar
1. Escribir por WhatsApp a **+57 314 820 9662** desde un **número nuevo** (para que el candado
   anti-reenvío no bloquee).
2. Recorrer: nombre → municipio → club → "sí" amenidades → "quiero ver los terrenos".
3. Debe llegar: intro + PDF + "¿en cuál terreno y sector?".
4. Decir "me gusta el 71" → debe **ofrecer** agendar (no forzar). Aceptar → pide datos uno por uno.
5. Logs: `firebase functions:log --only onMessageCreated` (buscar `[AI] Plano enviado`).

## Memorias relacionadas (contexto del proyecto)
`crm-ia-envio-plano-auto`, `crm-ycloud-update-startswith-fix`, `crm-biblioteca-portafolios`,
`crm-plano-disponibilidad-envio`, `crm-calendar-feature`, `crm-deploy-flow`,
`crm-multitenancy-auth`, `crm-whatsapp-provider-ycloud`.
