import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Paleta Corporativa Meraki Grupo Constructor (Manual de Marca)
        meraki: {
          gold: '#B7871C',        // Oro Principal (R:183, G:135, B:28)
          goldWarm: '#B49739',    // Oro Cálido (R:180, G:151, B:57)
          goldDark: '#947018',    // Oro Oscuro (R:148, G:112, B:24)
          goldLight: '#D9B545',   // Oro Claro (R:217, G:181, B:69)
          charcoal: '#373634',    // Grafito (R:55, G:53, B:52)
          black: '#0D060A',       // Negro Meraki (R:13, G:6, B:10)
        },
        // Escala de grises oscuros para la UI del CRM
        surface: {
          DEFAULT: '#0d0d0f',
          1:       '#141416',
          2:       '#1c1c1f',
          3:       '#242428',
          4:       '#2e2e33',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

export default config;
