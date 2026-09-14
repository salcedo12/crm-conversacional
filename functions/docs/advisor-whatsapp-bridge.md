# WhatsApp de asesor por QR

Este flujo permite que cada asesor conecte su WhatsApp como dispositivo vinculado y que el CRM refleje las conversaciones manuales en la bandeja. El CRM no mantiene sesiones de WhatsApp Web; eso lo hace un servicio separado llamado puente.

## Variables

- `ADVISOR_WHATSAPP_BRIDGE_BASE_URL`: URL base del puente.
- `ADVISOR_WHATSAPP_BRIDGE_API_KEY`: API key para llamadas desde Functions hacia el puente.
- `ADVISOR_WHATSAPP_WEBHOOK_SECRET`: secreto que el puente envia al webhook del CRM.

## Endpoints que debe exponer el puente

### `POST /advisor-whatsapp/session/qr`

Headers:

- `X-Bridge-Key: <ADVISOR_WHATSAPP_BRIDGE_API_KEY>`

Body:

```json
{
  "companyId": "empresa_demo",
  "advisorId": "uid-del-asesor"
}
```

Respuesta esperada:

```json
{
  "status": "qr_pending",
  "qrCodeDataUrl": "data:image/png;base64,...",
  "expiresAt": "2026-08-07T15:00:00.000Z"
}
```

Cuando ya esta conectado puede responder:

```json
{
  "status": "connected",
  "phone": "+573001112233",
  "displayName": "Asesor Ventas",
  "lastSeenAt": "2026-08-07T14:50:00.000Z"
}
```

### `POST /advisor-whatsapp/session/disconnect`

Usa los mismos headers y body. Debe cerrar la sesion del asesor en el puente.

## Webhook hacia el CRM

El puente debe llamar la Cloud Function `advisorWhatsappWebhook` cada vez que vea un mensaje entrante o saliente de una sesion conectada.

Headers:

- `X-Advisor-Whatsapp-Secret: <ADVISOR_WHATSAPP_WEBHOOK_SECRET>`

Body:

```json
{
  "companyId": "empresa_demo",
  "advisorId": "uid-del-asesor",
  "phone": "+573001112233",
  "direction": "outbound",
  "content": "Hola, claro que si.",
  "externalMessageId": "advisor-wa-message-id",
  "customerName": "Cliente Ejemplo",
  "createdAt": 1786110000000
}
```

Campos opcionales para archivos:

```json
{
  "mediaUrl": "https://...",
  "mediaType": "image/jpeg",
  "fileName": "foto.jpg"
}
```

## Reglas de uso

- Este canal es para conversaciones manuales, no envios masivos.
- El CRM guarda el historial y apaga la IA del lead reflejado para evitar respuestas duplicadas.
- Si el lead no existe, se crea y se asigna al asesor que tiene la sesion QR.
