import adapter from '@sveltejs/adapter-static'
import { sveltekit } from '@sveltejs/kit/vite'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const base = (process.env.TUTOR_BASE_PATH ?? '').trim().replace(/\/+$/, '')

export default defineConfig({
  define: { __TUTOR_BASE__: JSON.stringify(base) },
  plugins: [
    tailwindcss(),
    sveltekit({
      paths: { base: base as '' | `/${string}` },
      compilerOptions: {
        runes: ({ filename }) =>
          filename.split(/[/\\]/).includes('node_modules') ? undefined : true,
      },
      adapter: adapter({ fallback: 'index.html', strict: false }),
    }),
  ],
  resolve: {
    alias: {
      '@tutor/core': fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url)),
    },
  },
  server: {
    proxy: { '/api': 'http://127.0.0.1:4318' },
    host: true,
  },
})
