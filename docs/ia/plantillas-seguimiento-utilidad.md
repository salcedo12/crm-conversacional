# Plantillas de seguimiento de la IA — versión UTILIDAD (borrador)

Las 3 plantillas actuales (`seguimiento_inicial_prospecto`, `opciones_proyectos_meraki`,
`reactivacion_interes_meraki`) son de categoría **MARKETING**. Meta limita cuántas
plantillas de marketing recibe cada persona (error 131049): aparecen "enviadas" en el CRM
pero nunca llegan al teléfono.

Para que Meta las acepte como **UTILIDAD** deben hablar de la **solicitud que hizo el
cliente** (su pedido de información), sin promociones, precios, bonos ni invitaciones a
comprar. Meta revisa y puede reclasificarlas como marketing si el texto suena comercial.

Variable `{{1}}` = primer nombre del cliente (la que ya envía el sistema).

| Paso | Cuándo | Nombre | Texto |
|---|---|---|---|
| 1 | 24 h sin respuesta | `seguimiento_solicitud_info` | Hola {{1}}, te escribimos sobre tu solicitud de información de terrenos campestres con Grupo Constructor Meraki. ¿Pudiste revisar la información que te enviamos? Si tienes alguna duda, responde a este mensaje y te ayudamos. |
| 2 | 3 días sin respuesta | `estado_solicitud_info` | Hola {{1}}, tu solicitud de información con Grupo Constructor Meraki sigue abierta. Si quieres que un asesor te contacte para resolver tus preguntas, responde SÍ. Si ya no la necesitas, responde NO y cerramos tu solicitud. |
| 3 | 8 días sin respuesta | `cierre_solicitud_info` | Hola {{1}}, vamos a cerrar tu solicitud de información con Grupo Constructor Meraki. Si aún la necesitas, responde a este mensaje y la mantenemos activa. |

Idioma: español (`es`). Categoría: `UTILITY`. Sin botones ni encabezado (menos motivos de rechazo).

## Pasos

1. Crear las 3 en el CRM (Plantillas → nueva, categoría Utilidad) para que se registren en YCloud y pasen a revisión de Meta.
2. Cuando Meta las apruebe como UTILIDAD, cambiar los nombres en **Asistente IA → Seguimientos**.
3. Si Meta las reclasifica como MARKETING, dejar las actuales: no hay ventaja en cambiarlas.
