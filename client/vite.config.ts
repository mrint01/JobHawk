import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const API_PORT = process.env.SERVER_PORT ?? 3001

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // During development all /api calls are forwarded to the Express server
      '/api': {
        target: `http://localhost:${API_PORT}`,
        changeOrigin: true,
      },
    },
  },
})
