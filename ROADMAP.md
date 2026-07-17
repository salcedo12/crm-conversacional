# Meraki CRM — Pendientes y mejoras

Estado a 2026-06-25. Documento vivo: marcar con ✅ lo que se complete.

## ✅ Hecho en esta sesión

- **Sincronización de citas con Google Calendar + Meet.** Causa raíz: los leads entrantes nunca recibían `assignedTo`, así que la IA agendaba sin asesor → sin evento en Google y sin Meet. Solucionado con auto-asignación (ver abajo).
- **Validación anti-cruce al agendar citas.** Antes de crear una cita, la IA valida disponibilidad real del asesor asignado contra citas del CRM y eventos de Google Calendar. Si el horario está ocupado, no agenda encima: responde con opciones cercanas disponibles para que el lead escoja.
- **Auto-asignación de leads (round-robin).** Nuevo `modules/leads/leadAssignment.service.ts`. Cada lead nuevo (ycloud / meta / twilio) se asigna al asesor de menor carga, **prefiriendo** a quien tenga Google conectado. Asignación perezosa también al agendar un lead viejo sin asesor.
- **Reasignar / cambiar de asesor.** Backend `listAdvisors` + `reassignLead` (solo admin/manager). UI: selector de asesor en el `LeadDrawer` (muestra 📅 si el asesor tiene Google conectado).
- **Envío masivo (broadcasts).** Backend `sendBroadcast` + `listBroadcasts` (módulo `broadcasts/`). UI: página **Masivos** (selección de plantilla aprobada, audiencia por todos/estado/etiqueta, variables, confirmación, historial). Sender de plantillas centralizado en `modules/messages/templateSender.service.ts` (reusado por envío individual y masivo).
- **Masivos con nombres automáticos.** Las variables de nombre (`{{nombre}}`, `{{name}}`, `{{1}}` en saludo tipo "Hola {{1}}") ya no se piden manualmente en la UI y se rellenan con el nombre del lead/CRM. Si el nombre está vacío o parece genérico, se usa un fallback limpio para evitar enviar `{{nombre}}`.
- **Corrección de pantalla negra en Masivos.** Se normalizó el manejo de fechas `createdAt` devueltas por callable/Firebase para evitar el error `toMillis is not a function` después de enviar un masivo.
- **Dashboard de métricas / KPIs.** Backend `getDashboardMetrics` (`http/metrics.function.ts`) agrega leads por estado/fuente/asesor, citas (próximas/completadas/canceladas), tasa de conversión, nuevos leads 7/30d y tendencia 14 días. UI: página **Resumen** en `/dashboard` (antes redirigía al inbox), con tarjetas KPI y gráficos CSS. Ruta y menú añadidos.
- **Mejora visual y operativa de Leads.** La pantalla principal ahora tiene métricas, filtros compactos, tabla más legible, columna de asesor, actividad reciente, tags y una tarjeta lateral de contacto más completa con edición, control de IA y acceso directo a la conversación.
- **Importación de contactos y listas.** Se agregó flujo de importación CSV desde Leads: subir archivo, mapear columnas, verificar consentimiento y crear contactos. La importación crea una lista tipo importación, permite etiquetas, deduplica por teléfono y actualiza contactos existentes.
- **Listas inteligentes de leads.** Se agregó barra de listas en Leads y creación de listas inteligentes a partir de filtros actuales (`estado`, IA, asesor, etiquetas, bandeja). También se puede eliminar listas desde el menú.

## 🔜 Pendientes / mejoras propuestas

### Alta prioridad
- **Bug UI calendario "+N más".** Al hacer clic en "+2 más" en una celda del día no expande ni muestra el resto de eventos. Falta el modal/popover del día. (Frontend, `features/calendar`.)
- **Envío masivo a escala.** Hoy `sendBroadcast` envía de forma síncrona (tope 1000, concurrencia 5) dentro de una sola invocación. Para listas grandes conviene mover a una **cola** (Firestore + función programada / Cloud Tasks) y respetar límites de velocidad del BSP. También: throttle configurable y reintentos de fallidos.
- **Conteo real de audiencia en Masivos.** El preview usa solo los 50 leads en memoria del realtime. Añadir un callable `countAudience` para mostrar el total exacto antes de enviar.
- **Paginación/consulta servidor para Leads.** La UI de Leads ya tiene importación y listas, pero todavía carga un subconjunto reciente en memoria. Para operar bases grandes tipo 18k+ contactos, falta paginación real, búsqueda y filtros desde backend/Firestore, no solo filtrado local.

### Media prioridad
- **Panel/CRUD de usuarios (asesores).** Hoy los asesores se aprovisionan a mano en Firestore (`companies/{companyId}/users`). Falta UI para invitar/crear asesores, asignar rol y activar/desactivar. Necesario para que el round-robin tenga varios asesores reales.
- **Métricas avanzadas.** El dashboard actual no incluye: mensajes IA vs. manual (requiere leer subcolecciones de mensajes), tiempo de respuesta, ni filtros por rango de fechas. Añadir cuando haya volumen.
- **Agendar cita manual desde el CRM.** El backend tiene `bookAppointmentManual` (crea cita ligada al lead con recordatorio/seguimiento), pero la UI solo crea eventos sueltos de Google (`createCalendarEvent`). Falta el botón "Agendar cita" desde el lead/conversación.
- **Historial de importaciones.** El flujo ya crea listas de importación, pero falta una vista tipo auditoría con archivo, fecha, usuario, creados/actualizados/omitidos y descarga de errores.
- **Administrar campos de contactos.** La importación mapea campos base (`nombre`, `teléfono`, `email`, `empresa`), pero falta una UI para campos personalizados como en CRMs grandes.
- **Segmentos de masivos basados en listas.** Ahora Masivos filtra por estado/etiqueta; falta poder escoger listas inteligentes o listas de importación como audiencia directa.

### Limpieza técnica (deuda)
- **Código muerto legacy.** `services/agenda.service.ts`, `services/google-calendar.service.ts` (cuenta de servicio + link mock), `services/lead-assignment.service.ts` (campo `assignedToId` y roles MAYÚSCULA obsoletos), `api/conversations.ts`, `api/leads.ts`, `services/openai.service.ts`, `services/whatsapp-sender.service.ts`, `webhooks/whatsapp.ts`, `scheduled/reminders.ts` (vs. el nuevo flujo en `http/` + `modules/` + `triggers/`). Revisar qué sigue exportándose en `index.ts` y borrar lo no usado.
- **Commitear.** Gran parte del refactor (`http/`, `modules/`, `integrations/`, `triggers/`) está sin commit. Hacer commits temáticos.
- **Code-splitting frontend.** El bundle pasa de 500 kB; considerar `import()` dinámico por ruta.
- **Nav móvil ignora `adminOnly`.** La barra inferior móvil muestra todos los ítems (incl. Plantillas/Masivos) a cualquier rol. Filtrar igual que el sidebar.
- **Validación visual autenticada.** El build pasa, pero varias vistas nuevas no se pudieron verificar con sesión autenticada desde el navegador local porque el entorno abrió en login. Validar manualmente en una sesión real.
- **Reglas/índices para nuevas listas.** Las listas se consumen por callables, pero conviene revisar reglas e índices si luego se exponen lecturas directas o consultas más complejas.

## Notas de arquitectura

- **Flujo activo:** webhooks `http/*Webhook.function.ts` → guardan mensaje → trigger `triggers/messageCreated.trigger.ts` → `modules/ai/aiOrchestrator.service.ts` (function calling `agendar_cita`) → `modules/appointments/appointments.service.ts`.
- **Asignación:** un lead se asigna al crearse; la cita se crea en el Google Calendar del asesor asignado (OAuth por asesor en `companies/{companyId}/googleConnections/{advisorId}`).
- **Disponibilidad:** `availability.service.ts` cruza disponibilidad entre citas CRM y Google Calendar del asesor antes de confirmar una cita. Si hay conflicto, devuelve alternativas cercanas.
- **Plantillas masivas:** solo plantillas con `status: 'approved'` pueden salir fuera de la ventana de 24h de WhatsApp.
- **Ventana de WhatsApp:** enviar una plantilla aprobada no reabre automáticamente la ventana de conversación libre de 24h; la ventana se reabre cuando el lead responde.
- **Listas:** `leadLists` vive por compañía y se administra vía callables (`listLeadLists`, `createLeadList`, `deleteLeadList`, `importLeadsChunk`). Hay listas `smart` por filtros y listas `import` generadas por CSV.
