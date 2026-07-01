/** Shared Tailwind preset — maps DESIGN.md tokens (CSS variables) to Tailwind's theme.
 *  Consumed by apps/web and packages/ui so every surface is on-brand by default. */
const ramp = (name) => ({
  50: `var(--${name}-50)`,
  100: `var(--${name}-100)`,
  200: `var(--${name}-200)`,
  300: `var(--${name}-300)`,
  400: `var(--${name}-400)`,
  500: `var(--${name}-500)`,
  600: `var(--${name}-600)`,
  700: `var(--${name}-700)`,
  800: `var(--${name}-800)`,
  900: `var(--${name}-900)`,
});

/** @type {import('tailwindcss').Config} */
module.exports = {
  theme: {
    extend: {
      colors: {
        teal: ramp('teal'),
        green: ramp('green'),
        orange: ramp('orange'),
        n: {
          0: 'var(--n-0)',
          25: 'var(--n-25)',
          50: 'var(--n-50)',
          100: 'var(--n-100)',
          200: 'var(--n-200)',
          300: 'var(--n-300)',
          400: 'var(--n-400)',
          500: 'var(--n-500)',
          600: 'var(--n-600)',
          700: 'var(--n-700)',
          800: 'var(--n-800)',
          900: 'var(--n-900)',
          950: 'var(--n-950)',
        },
        primary: { DEFAULT: 'var(--primary)', hover: 'var(--primary-hover)' },
        accent: 'var(--accent)',
        success: { DEFAULT: 'var(--success)', bg: 'var(--success-bg)', bd: 'var(--success-bd)' },
        warning: { DEFAULT: 'var(--warning)', bg: 'var(--warning-bg)', bd: 'var(--warning-bd)' },
        danger: { DEFAULT: 'var(--danger)', bg: 'var(--danger-bg)', bd: 'var(--danger-bd)' },
        info: { DEFAULT: 'var(--info)', bg: 'var(--info-bg)', bd: 'var(--info-bd)' },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        eyebrow: ['11px', { lineHeight: '16px', letterSpacing: '0.09em', fontWeight: '600' }],
      },
      borderRadius: {
        sm: 'var(--r-sm)',
        md: 'var(--r-md)',
        lg: 'var(--r-lg)',
        xl: 'var(--r-xl)',
        pill: 'var(--r-pill)',
      },
      boxShadow: {
        xs: 'var(--sh-xs)',
        sm: 'var(--sh-sm)',
        md: 'var(--sh-md)',
        lg: 'var(--sh-lg)',
      },
      spacing: {
        sidebar: 'var(--sidebar-w)',
        rail: 'var(--rail-w)',
        topbar: 'var(--topbar-h)',
      },
    },
  },
};
