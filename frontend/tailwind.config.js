/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: { extend: { colors: { ink: '#17221f', muted: '#73807c', paper: '#f6f7f9', forest: '#1b5d48' }, boxShadow: { card: '0 12px 32px rgba(24, 41, 35, .06)' } } },
  plugins: [],
};
