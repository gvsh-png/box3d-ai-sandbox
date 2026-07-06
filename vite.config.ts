import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      'mp4-muxer-local': '/src/vendor/mp4-muxer.mjs',
    },
  },
  optimizeDeps: {
    include: ['jsonrepair'],
  },
  server: {
    port: 5173,
    host: true,
  },
})
