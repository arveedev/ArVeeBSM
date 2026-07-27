/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        neutral: {
          950: '#0A0A0A',
          900: '#171717',
          800: '#262626',
          700: '#404040',
          600: '#525252',
        },
        app: {
          text: '#FFFFFF',
        },
        brand: {
          neon: '#00FFA3',
          amber: '#F59E0B',
          crimson: '#EF4444',
          // Fixed, never theme-variable - this is contrast text sitting
          // on the brand-neon accent or a light pile-box fill, not on
          // the app's background, so it must always stay dark.
          contrast: '#0A0A0A',
        }
      },
    },
  },
  plugins: [],
}
