import adapter from '@sveltejs/adapter-static'
import { sveltekit } from '@sveltejs/kit/vite'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [
    tailwindcss(),
    sveltekit({
      compilerOptions: {
        // Force runes mode for the project, except for libraries.
        runes: ({ filename }) =>
          filename.split(/[/\\]/).includes('node_modules') ? undefined : true,
      },
      // SPA: the Bun server hosts the build and the API on the same origin.
      adapter: adapter({ fallback: 'index.html', strict: false }),
    }),
  ],
  server: {
    // Dev: proxy the API to the Bun server so cookies are same-origin.
    proxy: { '/api': 'http://127.0.0.1:4318' },
    host: true,
  },
})
