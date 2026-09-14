# Informe semanal de trabajo

Periodo: lunes 27 a viernes 31 de julio de 2026.

Fuente de revision: historial Git de los repositorios en `C:\Users\Ingenieria Software\Desktop\meraki` y archivos locales modificados. Los commits son evidencia confirmada por fecha; los cambios pendientes se agrupan por fecha de modificacion de archivos, por lo que pueden corresponder a trabajo local aun no commiteado.

## Resumen general

Durante la semana el trabajo principal estuvo concentrado en `crm-conversacional`, con avances de CRM, frontend, funciones Firebase, IA, notificaciones, agenda, llamadas automaticas, branding, empresas/plataforma, mensajes, SmartHome y ajustes de seguridad/reglas.

Tambien se detecto trabajo local en:

- `Merakipage`: bloqueo de citas de cartera hasta el 11 de agosto y ajustes posteriores de datos/banner/promocion.
- `abrePuerta-react`: ajustes fuertes del juego/landing de puerta, formulario, premios, participantes, assets y conexion SmartHome.
- `tour-meraki`: actualizacion masiva de coordenadas de proyectos y mejoras del panel administrativo de inventario/reconciliacion.

Repos sin actividad confirmada esta semana por commit o fecha de modificacion relevante: `control`, `crm-meraki`, `firma-digital`, `panel-prospectos-ui` y `juego-penal` no muestran trabajo fechado del 27 al 31 de julio en la evidencia revisada. `juego-penal` tiene cambios pendientes, pero sus fechas visibles son de junio.

## Lunes 27 de julio

### crm-conversacional

Se realizaron cuatro commits importantes:

- `feat(functions): contacto manual, marcar leido, mejoras de IA, seguridad webhook y tests`.
- `feat(frontend): contacto manual, leido entre sesiones, navegacion movil y config IA`.
- `feat: notas y recordatorios por lead, guardas de costo IA y backup de Firestore`.
- `perf/chore: code-splitting movil, aviso de envios fallidos, Sentry y upgrade de deps`.

Trabajo realizado:

- Se agrego contacto manual en el inbox y soporte backend para crear/gestionar contactos.
- Se implemento persistencia de estado leido/no leido entre sesiones.
- Se mejoro la navegacion movil y componentes de dashboard/inbox/leads.
- Se agregaron configuraciones de IA, insights, analisis de leads y reportes.
- Se reforzaron webhooks y validaciones de seguridad.
- Se agregaron notas y recordatorios por lead.
- Se incorporo backup programado de Firestore.
- Se agregaron guardas de costo para IA.
- Se optimizo el frontend con code splitting para movil.
- Se agrego aviso de envios fallidos y configuracion de Sentry/logging.
- Se actualizaron dependencias y bundles de build.
- Cambios locales del mismo dia incluyen branding inicial de la app, proveedor de branding, formulario de branding, upload de marca, ajustes visuales de login/home legal y reglas de storage.

## Martes 28 de julio

### Merakipage

Commit confirmado:

- `Bloquear citas de cartera hasta el 11 de agosto`.

Trabajo realizado:

- Se bloqueo la agenda de citas de cartera hasta el 11 de agosto.
- Se actualizaron datos de proyectos en `projectsData`.
- Quedaron ajustes locales relacionados con hero, footer, modal de nueva ubicacion, banner promocional e imagenes de puerta.

### crm-conversacional

Trabajo local detectado:

- Ajustes de configuracion de agenda y servicios de scheduling.
- Cambios en filtros y pagina de leads.
- Mejoras en panel de configuracion de IA.
- Ajustes en notificaciones del inbox y servicio de notificaciones.
- Incorporacion de `AppErrorBoundary`.
- Ajustes de Vite/PWA y service worker.
- Modificaciones en endpoints de `aiControl`, `appointments`, `leads`, `notifications`, `scheduling` y `updateLead`.
- Cambios en repositorio/servicio de citas y configuracion de agenda.
- Ajustes en trigger de sincronizacion SmartHome.

## Miercoles 29 de julio

### crm-conversacional

Trabajo local detectado:

- Creacion/modificacion de la carpeta `frontend-v2/mobile-app`.
- Ajustes en `pushNotifications.service`, relacionados con notificaciones de mensajes.

No se encontraron commits fechados este dia en los repos revisados.

## Jueves 30 de julio

### crm-conversacional

Trabajo local detectado:

- Refuerzo del flujo de autenticacion: `AuthProvider`, `auth.service`, tipos de auth, `main.tsx` y layout.
- Ajustes de plataforma/empresas: modulo `platform`, panel `PlatformCompaniesPanel`, endpoint `platformCompanies` y modulo `companies`.
- Trabajo en agenda/citas: `appointmentNotifier`, `daptaScheduling`, `appointments.service`, repositorio de citas y plantillas.
- Trabajo en llamadas automaticas: `AutoCallPanel`, servicio frontend de auto-call, endpoint `autoCall`, modulo `autocall`, tarea programada `processAutoCalls` y tipos de llamadas.
- Cambios en mensajes: burbujas de mensaje, tipos de mensajes y procesos de medios.
- Ajustes de templates, rehosting/procesamiento de media y TTL de webhooks.
- Ajustes de SmartHome sync/events.
- Mejoras en asignacion de leads y claims de usuarios.
- Se eliminaron archivos de integracion Twilio en favor de los flujos actuales.

## Viernes 31 de julio

### crm-conversacional

Trabajo local detectado:

- Ajustes finales de indices Firestore y variables de entorno.
- Modificaciones en `useMessages` y servicio de templates.
- Cambios en `ycloudWebhook`, `metaMessagingWebhook` e incorporacion de modulo `metaLeads`.
- Incorporacion de `errorAlertWebhook`.
- Actualizacion de builds/PWA/service worker.

### abrePuerta-react

Trabajo local detectado:

- Ajustes en `functions/src/index.ts` y nuevo `functions/src/smarthome.ts`.
- Cambios importantes en componentes del juego/experiencia: `OpenDoor`, `Formulario`, `ConsultaPremio`, `Participantes`.
- Incorporacion de `RevanchaPrizeService` y `version`.
- Ajustes de estilos de participantes.
- El repositorio tambien tiene muchos assets nuevos o reemplazados de bonos, puerta, confeti, logos, botones y fondos, aunque varios fueron creados antes de esta semana.

### tour-meraki

Trabajo local detectado:

- Actualizacion masiva de coordenadas en archivos JSON de proyectos: Canarias, El Poblado, Mall Guatape, Rio, San Antonio, Santa Helena, Santorini, sectores, Colorado, Lagunilla, Las Vegas, Llanogrande, Los Angeles, Medina, Texas, entre otros.
- Mejoras del panel administrativo de inventario: `LotsTable`, `LotsMobileList`, `AdminPanel`.
- Ajustes en hooks/utilidades de inventario.
- Archivos nuevos de conciliacion e integracion SmartHome detectados en el proyecto, aunque sus fechas visibles son del 23 de julio.

## Estado por proyecto

### crm-conversacional

Estado: activo, con commits del lunes y muchos cambios pendientes.

Lineas principales:

- CRM conversacional con inbox, leads, reportes, marketing, dashboard e IA.
- Firebase Functions para contactos, notificaciones, webhooks, agenda, leads, usuarios, templates, llamadas automaticas, branding y empresas.
- Integraciones con SmartHome, YCloud, Meta y Dapta.
- PWA/service worker, builds y optimizacion movil.
- Seguridad: reglas, indices, validaciones y manejo de errores.

### Merakipage

Estado: commit del martes y cambios locales anteriores/posteriores.

Lineas principales:

- Bloqueo temporal de citas de cartera hasta el 11 de agosto.
- Ajustes de contenido de proyectos y piezas visuales/promocionales.

### abrePuerta-react

Estado: cambios locales fuertes, especialmente el viernes 31.

Lineas principales:

- Experiencia de abrir puerta, premios y participantes.
- Formulario, consulta de premio, assets graficos y estilos.
- Conexion/funciones SmartHome y posible flujo de revancha.

### tour-meraki

Estado: cambios locales, especialmente coordenadas el viernes 31.

Lineas principales:

- Coordenadas de proyectos/lotes.
- Panel administrativo de inventario.
- Reconciliacion e integracion SmartHome para inventario.

## Observaciones

- Hay bastante trabajo sin commit en varios repos. Para cerrar la semana ordenadamente conviene hacer commits separados por proyecto y tema.
- En `crm-conversacional`, el volumen de cambios pendientes es grande y mezcla frontend, backend, build, reglas y funciones programadas; conviene dividirlo en al menos 3 o 4 commits funcionales.
- En `tour-meraki`, los cambios de coordenadas parecen masivos y deberian validarse visualmente en el tour antes de publicar.
- En `abrePuerta-react`, los cambios visuales y de premios tambien merecen prueba manual completa del flujo.
