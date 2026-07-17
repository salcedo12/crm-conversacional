# Activación de Llamadas IA (Dapta) en el CRM

Guía para encender la integración de llamadas con IA. Todo el código ya está
implementado y desplegado; estos son los pasos que faltan, que dependen de Dapta.

## Estado actual

- ✅ Backend desplegado: `daptaWebhook`, `startAiCall`, `listRecentCalls` + reglas + índices.
- ✅ Frontend: botón "Llamar con IA" en cada lead, historial en la ficha y página "Llamadas IA".
- ⏳ Pendiente: recuperar el espacio de Dapta + créditos, configurar 2 cosas, redeploy y probar.

## Paso 1 — Recuperar la propiedad de Dapta (bloqueador)

Pedir a Asinpro (info@asinpro.co) o al soporte de Dapta que transfieran el **Owner**
del espacio "Grupo Constructor Meraki" a tu cuenta (diseno.meraki1@gmail.com) y que
**NO eliminen el espacio** (se perderían las llamadas). Luego reactivar el plan/créditos.

## Paso 2 — Lanzar llamadas desde el CRM (variables de entorno)

En `functions/.env` agregar:

```
DAPTA_CALL_TRIGGER_URL=https://api.dapta.ai/api/61fa0d4275f4f7b1/llamada-nuevolead
DAPTA_API_KEY=oVlnF-61fa0d42-4593-4a62-8a39-45f375f4f7b1-a
# Opcional pero recomendado (validar el webhook entrante):
DAPTA_WEBHOOK_SECRET=
```

> La URL y la API Key salen del nodo **Start** del flujo `Llamada-NuevoLead` en Dapta.
> Cada flujo tiene su propia API Key.

Datos que el CRM envía al flujo (ya mapeados al nodo "Dapta Phone Call"):
`phone`, `first_name`, `contact_id` (= leadId) y todos los campos de `lead.metadata`
(ej. `En_que_ubicacion_te_interesa_el_Terreno`).

## Paso 3 — Recibir el resultado en el CRM (nodo en Dapta)

En el flujo **`webhook_call`**, después del nodo `call_result`, agregar un nodo **API**:

- **Request:** POST
- **URL:** `https://us-central1-crm-conversacional.cloudfunctions.net/daptaWebhook`
  - Si configuraste `DAPTA_WEBHOOK_SECRET`, usar `...?secret=ESE_VALOR`
- **Body:** raw (JSON):

```json
{
  "contact_id": "{{call_result.contactId}}",
  "summary": "{{trigger.body.call.call_analysis.call_summary}}",
  "transcript": "{{trigger.body.call.transcript}}",
  "recording_url": "{{call_result.callUrl}}",
  "stage": "{{call_result.stage}}",
  "duration": "{{trigger.body.call.total_duration_seconds}}",
  "status": "completed"
}
```

Los nodos viejos de GoHighLevel (`add_note`, `add_tag`, `add_call_url`) pueden quedarse
(fallan en silencio, `on_error: continue`) o borrarse.

## Paso 4 — Redeploy

```
FUNCTIONS_DISCOVERY_TIMEOUT=120 firebase deploy \
  --only "functions:crm-api:startAiCall,functions:crm-api:daptaWebhook"
```

## Paso 5 — Llamada de prueba

1. Desde un lead, botón "Llamar con IA".
2. Al terminar la llamada, revisar que aparezca el resumen en la ficha del lead y en
   la página "Llamadas IA".
3. Si algún campo sale vacío, revisar el campo `raw` que guarda cada llamada en
   `companies/{cid}/leads/{leadId}/calls/{callId}` y ajustar el mapeo.

## Alcance — Fase 1 (solo calificación)

El agendamiento durante la llamada queda para Fase 2. El flujo `get_free_slots`
depende de GoHighLevel, así que al salir de GHL la variable `schedule_list` quedará
vacía: la IA califica al lead pero no ofrece horarios concretos. No rompe la llamada
(`on_error: continue`), pero conviene ajustar el prompt del agente en Dapta para que
no prometa horarios. Opcional: quitar los nodos `get_slots`/`process_slots` del flujo
de llamada para que no intenten llamar a GHL.

**Fase 2 (futuro):** crear un endpoint en el CRM que devuelva los horarios libres del
Google Calendar del asesor y apuntar ahí el nodo `get_slots`, para que la IA agende en
el calendario propio.

## Referencia técnica

- Motor de voz bajo Dapta = **Retell**. Payload del resultado:
  `trigger.body.call.{call_analysis.call_summary, transcript, recording_url, total_duration_seconds, dynamic_variables.contact_id}`.
- Desenlaces (`stage`) que clasifica Gemini → traducidos por `friendlyOutcome()`:
  interesado, no_interesado, no_contesto, recontactar, no_califica, no_concluida,
  agendado, citavirtual, citapresencial.
- IPs públicas de Dapta (auto-confiadas por el webhook): 3.135.117.63, 3.143.158.83, 3.14.139.223.
