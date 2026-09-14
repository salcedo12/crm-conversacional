const fs = require('fs');
const file = 'C:/crm-conversacional/functions/src/modules/ai/aiOrchestrator.service.ts';
let content = fs.readFileSync(file, 'utf8');

const oldText = 
`        \`Si el lead dice el club pero no el sector (ej. "el 15 de cañón") O usa un color (ej. "el 15 amarillo"), \` +
        \`DEBES deducir el sector correcto usando el mapa de arriba. NUNCA pases "Cañón de Arizona" como sector; \` +
        \`pasa "San Francisco" si dijo amarillo, "Texas" si dijo azul, etc. Si no da el sector ni el color, pregúntale en qué sector está. \` +`;

const newText = 
`        \`¡MUY IMPORTANTE SOBRE LOS COLORES!: Si el lead pide un terreno por color (ej. "el 43 amarillo"), REVISA PRIMERO de qué club de campo están hablando. \` +
        \`NUNCA asumas automáticamente que "amarillo" es San Francisco si están hablando de otro proyecto como Llano Grande. \` +
        \`Busca hacer coincidir el color ÚNICAMENTE con los sectores del club de campo del que vienen hablando. Si el lead pide un color en un proyecto del que no sabes sus colores, PREGÚNTALE a qué etapa pertenece ese color. NUNCA inventes cruces entre proyectos diferentes. \` +
        \`Si no da el sector ni el color, pregúntale en qué sector está. \` +`;

if (content.includes(oldText)) {
  content = content.replace(oldText, newText);
  fs.writeFileSync(file, content);
  console.log("Replaced successfully");
} else {
  console.log("Could not find old text exactly. Finding by lines...");
  // Let's do a regex replace just in case of weird encoding
  content = content.replace(/`Si el lead dice el club pero no el sector.*?preg.*?ntale en qu.*? sector est.*?\.\s*` \+/s, newText);
  fs.writeFileSync(file, content);
  console.log("Replaced with regex");
}
