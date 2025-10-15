import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
    './providers/**/*.{ts,tsx}'
  ],
  theme: {
    extend: {
      colors: {
        primary: '#111111',
        accent: '#ff6b00'
      }
    }
  },
  plugins: []
};

export default config;
