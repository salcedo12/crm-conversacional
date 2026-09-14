# Puente WhatsApp de asesor

Servicio Node que mantiene sesiones de WhatsApp por asesor, genera QR y refleja mensajes manuales al CRM.

## Ejecutar local

```powershell
cd "C:\Users\Ingenieria Software\Desktop\meraki\crm-conversacional\advisor-whatsapp-bridge"
Copy-Item .env.example .env
npm install
npm start
```

En otra terminal:

```powershell
ngrok http 3333
```

Luego configura en `functions/.env`:

```env
ADVISOR_WHATSAPP_BRIDGE_BASE_URL=https://URL-DE-NGROK
ADVISOR_WHATSAPP_BRIDGE_API_KEY=la-misma-de-BRIDGE_API_KEY
ADVISOR_WHATSAPP_WEBHOOK_SECRET=la-misma-de-CRM_WEBHOOK_SECRET
```

Y despliega las funciones del CRM con `FUNCTIONS_DISCOVERY_TIMEOUT=60`.

## Endpoints

- `GET /health`
- `POST /advisor-whatsapp/session/qr`
- `POST /advisor-whatsapp/session/disconnect`

Todos los `POST` requieren el header `X-Bridge-Key`.
