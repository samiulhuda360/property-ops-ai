import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// API_PORT and CLIENT_PORT let several copies of the app run side by side (defaults: API 3001, app 5173).
export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.CLIENT_PORT || 5173),
    proxy: {
      '/api': {
        target: `http://localhost:${process.env.API_PORT || 3001}`,
        changeOrigin: true,
      },
    },
  },
})
