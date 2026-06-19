import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
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
