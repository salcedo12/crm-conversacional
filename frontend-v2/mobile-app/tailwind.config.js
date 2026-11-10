/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    "./App.{js,jsx,ts,tsx}",
    "./src/**/*.{js,jsx,ts,tsx}"
  ],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        // En frontend-v2/src/index.css todas las clases violet-* están sobreescritas
        // con --brand-primary (#B7871C Oro Corporativo Meraki).
        violet: {
          DEFAULT: '#B7871C',
          50:  '#FBF8F0',
          100: '#F4ECE0',
          200: '#E5CE93',
          300: '#CBA95C',
          400: '#D9B545',
          500: '#B7871C',
          600: '#B7871C',
          700: '#947018',
          800: '#7A530A',
          900: '#5C3E08',
          950: '#2A1D04',
        },
        brand: {
          DEFAULT: '#B7871C',
          50:  '#FBF8F0',
          100: '#F4ECE0',
          200: '#E5CE93',
          300: '#CBA95C',
          400: '#D9B545',
          500: '#B7871C',
          600: '#B7871C',
          700: '#947018',
        },
        meraki: {
          gold:            '#B7871C',
          goldWarm:        '#B49739',
          goldDark:        '#947018',
          goldLight:       '#D9B545',
          charcoal:        '#373634',
          black:           '#0D060A',
          champagne:       '#FAF5EA',
          champagneLight:  '#FBF8F0',
          champagneDark:   '#F4ECE0',
          champagneBorder: '#E8DCB8',
        },
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
