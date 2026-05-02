import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'

export default defineConfig({
  plugins: [solid()],
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: 'index.vite.html',
    },
  },
})