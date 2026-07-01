const preset = require('@masquare/config/tailwind-preset');

/** @type {import('tailwindcss').Config} */
module.exports = {
  presets: [preset],
  content: [
    './index.html',
    './src/**/*.{ts,tsx}',
    '../../packages/ui/src/**/*.{ts,tsx}',
  ],
  theme: { extend: {} },
  plugins: [],
};
