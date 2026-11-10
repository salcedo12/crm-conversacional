import { setGlobalOptions } from 'firebase-functions/v2';

// Default para TODAS las functions que no declaren su propia memoria.
// Con 256MiB (default de Firebase) solo cargar el bundle completo ya usa 60-80%,
// y varias funciones de uso diario llegaban al 90-98% o se quedaban sin memoria (oct-2026).
// Debe importarse ANTES que cualquier definición de función (primera línea de index.ts).
setGlobalOptions({ memory: '512MiB' });
