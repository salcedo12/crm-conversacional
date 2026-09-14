const fetch = require('node-fetch');

async function check() {
    const sectors = ["Texas", "Colorado", "Las Vegas", "Los Angeles", "San Francisco"];
    for (const sector of sectors) {
        const promises = [];
        for (let i = 1; i <= 100; i++) {
            promises.push(
                fetch(`https://us-central1-disponibilidad-e8a81.cloudfunctions.net/cotizacionNow?club=${encodeURIComponent(sector)}&terreno=${i}&pago=cuotas&meses=18`)
                .then(r => r.json())
                .then(data => {
                    if (data.available === true || data.available === 'true' || (data.url && data.available !== false)) {
                        console.log(`FOUND AVAILABLE: ${i} in ${sector}`);
                    }
                })
                .catch(() => {})
            );
        }
        await Promise.all(promises);
    }
}
check();
