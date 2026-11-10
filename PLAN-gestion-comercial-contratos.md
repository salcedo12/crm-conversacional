# Gestión comercial — Contratos de preventa y promesa

Estado a 2026-10-26. Documento vivo.

## Decisión

Módulo **Negocios** dentro del CRM (no sistema aparte). Cada pieza conserva su dueño:

| Pieza | Dónde vive |
|---|---|
| Ficha de clientes, negocio, plan de pagos, generación de documentos | CRM (`functions/src/modules/deals`, `frontend-v2/src/features/deals`) |
| Inventario / disponibilidad | Proyecto Firebase `disponibilidad-e8a81` (tour-meraki). El CRM lee `proyectos_resumen` en vivo y reserva por endpoint con transacción |
| Firma | DocuBlock (misma organización y API Key que usa SmartHome) |

## Flujo

1. Lead → ficha de compradores (1..N): tipo de persona, nombres, apellidos, fecha de nacimiento, estado civil,
   género, ciudad de residencia, dirección, tipo y número de identificación, ciudad y fecha de expedición, celular, correo.
2. Lote desde el inventario en vivo (solo DISPONIBLE).
3. Plan de negocio: valor del terreno, beneficio, cesantías, separación, cuotas (separación / ordinarias / extraordinarias), referido, observaciones.
4. Se genera el PDF de la **preventa** (plantilla Word + ficha legal del proyecto) y se envía a DocuBlock.
5. Preventa firmada → PDF firmado guardado, lote VENDIDO, **promesa generada automática** con el mismo plan (snapshot congelado) y enviada a firma.
6. Promesa firmada → SmartHome (etapa + bitácora), CAPI Purchase, informes.

## Ficha legal por proyecto

| Proyectos | Vendedor | NIT | Cuenta Davivienda / convenio |
|---|---|---|---|
| Cañón de Arizona | Compañía Constructora Meraki S+M S.A.S | 901590498-2 | 108900237588 / 1488121 |
| Laguna Mar, Río Claro, Llano Grande, Sobre Montañas | Grupo Constructor Meraki S.A.S ZOMAC | 901110049-0 | 168770042765 / 1171362 |

- El vendedor se decide por proyecto del CRM/inventario, **no** por el código de SmartHome (Llano Grande vive dentro del proyecto Cañón en SmartHome pero lo vende ZOMAC).
- Sobre Montañas no tiene textos legales en las plantillas 2026 (ubicación, licencia, linderos, amenidades): pedir a jurídica.
- En DocuBlock es una sola organización; por proyecto solo cambia el **directorio**.

## Firma con DocuBlock

- API: https://documenter.getpostman.com/view/31094055/2sA3e2gpwM
- Pruebas: http://canary.bridge.docublock.co/ — Producción: https://docublock-bridge-prod-hbfpxe3clq-ue.a.run.app
- Envío: `POST /api/documents/create-pdf-base64` con `baseFile` (PDF), `endorsementInput` (compradores con `iteration: 1`,
  firmantes de Meraki con `iteration: 2`), `template`, `directory`, `relatedInfo` (id del negocio).
- Estado: **consulta periódica** de `GET /api/documents/{id}` (cada 5–10 min, solo pendientes). No usamos webhook:
  el configurado en el panel (`docublockwebhook-xo5ev7kbfq-uc.a.run.app`) es de otro sistema y DocuBlock acepta una sola URL.
- Anular: se hace en el panel de DocuBlock. El CRM marca el documento anulado y lo confirma con la consulta periódica.
- La integración de `Desktop/meraki/crm-meraki` usa endpoints que no existen en la API oficial: no reutilizar.
- **No regenerar la API Key sin coordinar con SmartHome** (la comparten).

### Preguntas para DocuBlock — enviar AL FINAL, con todo construido

> Gracias por la documentación. Vamos a integrar nuestro CRM con DocuBlock para enviar a firma los contratos de preventa y promesa
> de compraventa. Generamos el PDF y lo enviamos por `create-pdf-base64`, con la misma organización y API Key que hoy usa SmartHome.
>
> 1. **Estado del documento:** en `GET /api/documents/{id}`, ¿qué estados puede tener el documento y cada firmante (pendiente, firmado,
>    rechazado, vencido, anulado)? ¿En qué campo vienen? Si un documento se anula desde la plataforma de DocuBlock, ¿se ve en este servicio?
> 2. **Documento firmado:** ¿cómo descargamos el PDF firmado con su certificado o evidencia de firma?
> 3. **Tipos de firmante:** ¿qué valores exactos van en `typeSign` (Cliente, cliente 2, cliente 3, Representante, Avalador)? ¿Cómo se envía un documento con más de 3 compradores?
> 4. **Responsable:** ¿cómo indicamos el responsable del documento por la API?
> 5. **Link de firma:** ¿la API devuelve el link de cada firmante? ¿Por qué medio les llega? ¿Cuánto dura vigente?
> 6. **Consultas de estado:** consultaremos cada 5 a 10 minutos los pendientes. ¿Hay límite de consultas?
> 7. **Ambiente de pruebas:** ¿token para canary? ¿Tiene `https`?
> 8. **API Key:** ¿algún inconveniente en usar la misma llave desde SmartHome y el CRM, o recomiendan una aparte?

## Pruebas en localhost (antes de producción)

Todo se prueba primero con los emuladores de Firebase (proyecto `demo-crm-local`: nunca toca Firebase, SmartHome ni WhatsApp reales).

1. `scripts\start-emulators.cmd` (o "firebase-emulators" en `.claude/launch.json`) → UI en http://127.0.0.1:4000
2. `node scripts/seed-emulator.cjs` → empresa, admin, asesor y 3 leads de prueba (usuarios y clave en el encabezado del script)
3. `cd frontend-v2 && npm run dev:local` → http://localhost:5175

Al cerrar los emuladores se borran los datos; volver a correr el paso 2.

## Estado

- **Fase 1 (hecha, probada en local):** ficha de 1–4 compradores desde el lead, fichas únicas por documento, anular.
- **Fase 2 (hecha, probada en local):** el negocio escoge su lote del inventario (solo DISPONIBLES, por proyecto y etapa,
  se refresca cada 20 s) y lo aparta en NEGOCIACION 24 h con transacción. Cambiar lote libera el anterior; anular libera el lote;
  si la reserva vence, el negocio lo avisa y permite volver a apartarlo. Cada cambio queda en `logs` como "CRM · asesor".

- **Fase 3 (hecha, probada en local):** plan de negocio en el negocio. Plazo desde la lista de precios real (Google Sheet del
  cotizador: 0/20/30/40 meses) como sugerencia editable; beneficio, cesantías con fondo, separación en N cuotas, ordinarias
  calculadas (residuo en la primera, como SmartHome), extraordinarias, bono descuento al final, referido y observaciones.
  Modo simple y específico. El backend solo guarda planes que cuadran; con compradores + lote + plan → "Plan listo".
  Si se cambia el lote, el plan queda marcado para revisar.
  - Pendiente de decidir: SmartHome tiene "¿Ajustar fechas extraordinaria?" (las ordinarias saltan el mes de una
    extraordinaria, como en la promesa de ejemplo). Hoy se logra en modo específico; se puede automatizar si lo usan siempre.

- **Fase 4 (hecha, probada en local):** preventa y promesa en Word desde las plantillas de jurídica.
  - Plantillas con campos en `functions/templates/` (preventa-2026.docx, promesa-2026.docx), generadas con
    `node scripts/contracts/build-templates.cjs "<preventa jurídica.docx>" "<promesa jurídica.docx>"`.
    Si jurídica cambia el Word, se vuelve a correr; el script avisa si un dato de ejemplo o algo resaltado en rojo quedó sin campo.
  - Los bloques "(texto para el proyecto X)" quedaron como secciones condicionales (vendedor S+M/ZOMAC; linderos,
    amenidades y cuentas de cada proyecto). Compradores 1..N se repiten en todas las tablas.
  - La promesa sale de los mismos datos guardados de la preventa (misma huella `snapshotHash`; solo cambia la fecha).
  - Word y datos (JSON) en Storage `companies/{c}/deals/{d}/{tipo}-v{n}.docx|json`; descarga por callable.
  - Revisar con jurídica: denominación de Río Claro, Cañón y Llano Grande (`legalProfiles.ts`); en la promesa la firma del
    vendedor no tiene bloque S+M para Cañón; solo el bloque de amenidades de Laguna Mar trae el párrafo final común
    ("Los diseños pueden ser modificados…"); el recuadro original de firma del comprador se repite por cada comprador (como SmartHome) y las firmas se mantienen juntas (si no caben, pasan completas a la hoja siguiente).
  - PDF: hoy se entrega Word (DocuBlock acepta `create-word-base64`). Si se quiere PDF propio, en producción hace falta
    LibreOffice/Gotenberg (Cloud Run).

### Antes de llevar la Fase 2 a producción

1. Dar a la cuenta de servicio de las Cloud Functions del CRM el rol **Cloud Datastore User** en el proyecto
   `disponibilidad-e8a81` (el CRM lee y escribe `inventario`, `proyectos_resumen` y `logs` de ese proyecto).
2. tour-meraki: hoy cualquier admin puede cambiar a mano un lote apartado por el CRM; y `liberarLotes` lo devuelve a
   DISPONIBLE a las 24 h (el CRM lo detecta y avisa). Cuando lleguen los documentos (Fase 4–5) hay que decidir si un lote
   con `crmDealId` en firma pasa a TRAMITE y si `liberarLotes` debe respetarlo.

## Fases

| Fase | Qué |
|---|---|
| 0 | Reglas del plan, plantillas Word con campos, ficha legal por proyecto, tipos y cálculos base |
| 1 | Ficha de clientes y negocio desde el lead (varios compradores, roles) |
| 2 | Inventario en vivo + `reservarLote` con transacción en disponibilidad + ajuste de `liberarLotes` |
| 3 | Plan de negocio (modo simple y específico, validaciones) |
| 4 | Generación de preventa y promesa (DOCX → PDF, versiones, snapshot) |
| 5 | Firma DocuBlock (envío, consulta de estado, tablero de firmas, anular, reenviar) |
| 6 | Cierre: lote VENDIDO, SmartHome, CAPI, informes |

## Pendiente de ustedes

- Negocios reales: preventa y promesa firmadas del mismo negocio (uno de Cañón y otro de otro proyecto; ideal con varios compradores,
  extraordinarias, beneficio y cesantías) + la pantalla del plan en SmartHome.
- Reglas del plan: ¿arras = 30 % del precio? ¿El beneficio resta del total o es el bono de la última cuota? ¿Las cesantías son forma de pago?
- API Key de DocuBlock (la misma de SmartHome) para cargar plantillas, directorios y usuarios.

## Decisiones de la Fase 5 (2026-10-29)

- Pantalla "Enviar a firma" igual a la de SmartHome: Documento, Plantilla, Tipo de directorio, Responsable (usuarios de
  DocuBlock), casilla "Validación fotográfica de clientes". Firmantes: compradores marcados (secuencia 1, tipo Cliente) +
  administrativos de Meraki listados desmarcados (secuencia 2); se marcan los que firman. Secuencia y tipo editables.
- Se envían los dos a firma a la vez, en orden: primero la preventa y enseguida la promesa (no se espera la firma de la
  preventa). Quedan los dos documentos en firma al mismo tiempo, cada uno con su estado.
- Plantilla: preventa y promesa usan "PROMESA DE COMPRAVENTA V1" de DocuBlock, con el directorio de promesas del proyecto.
- Mientras un contrato está en firma, el lote pasa a TRAMITE en disponibilidad (y `liberarLotes` debe respetarlo).

## Supuestos usados en el código (confirmar)

- Total del terreno = valor del terreno − beneficio = separación + ordinarias + extraordinarias + cesantías.
- El beneficio aparece en la promesa como la última "cuota bono descuento" (solo si pagó sin mora) y debe ser igual al beneficio.
- Las cesantías son una fuente de pago: suman al total pagado.
- El residuo del reparto de cuotas va a la primera cuota (así lo hace SmartHome: 33.568.116 + 3 × 33.568.115).
- Arras = 30 % del precio total (configurable por proyecto).

## Hallazgos de tour-meraki a corregir

- Los cambios de estado de lote se escriben desde el navegador sin transacción → riesgo de doble venta.
- `liberarLotes` libera lotes en TRAMITE a los 5 días aunque tengan contrato en firma.
- `initializeSummaries` y `regeneratePlanoNow` usan una clave fija en el código (`meraki-admin-2024`).
