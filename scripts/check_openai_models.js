const OpenAI = require('c:/crm-conversacional/functions/node_modules/openai');

const apiKey = process.env.OPENAI_API_KEY;

const openai = new OpenAI({ apiKey });

async function checkModels() {
  console.log('--- CONSULTANDO MODELOS DISPONIBLES EN LA API DE OPENAI ---');
  try {
    const list = await openai.models.list();
    const models = list.data.map(m => m.id);
    console.log(`Total de modelos disponibles en la cuenta: ${models.length}`);

    // Buscar si existe algún modelo con luna, gpt-5, 5.6
    const lunaMatches = models.filter(id => /luna/i.test(id));
    const gpt5Matches = models.filter(id => /gpt-5|5\./i.test(id));
    const gpt4oMatches = models.filter(id => /gpt-4o/i.test(id));
    const o1Matches = models.filter(id => /^o1|^o3/i.test(id));

    console.log('\nResultados de búsqueda:');
    console.log('- Modelos con "luna":', lunaMatches);
    console.log('- Modelos con "gpt-5" o "5.x":', gpt5Matches);
    console.log('- Modelos "gpt-4o" disponibles:', gpt4oMatches);
    console.log('- Modelos serie "o" (razonamiento):', o1Matches);

    console.log('\nListado completo de modelos relevantes:');
    models.sort().forEach(m => {
      if (/gpt|chat|o1|o3/i.test(m)) {
        console.log(' - ' + m);
      }
    });
  } catch (err) {
    console.error('Error consultando modelos:', err.message);
  }
}

checkModels().catch(console.error);
