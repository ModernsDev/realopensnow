import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { stoweObservationPath, stoweObservations } from './worker/stowe-observations.mjs'

export default defineConfig({
  plugins: [react(), {
    name: 'stowe-observations',
    configureServer(server) {
      server.middlewares.use(stoweObservationPath, async (request, response) => {
        if (request.method !== 'GET') {
          response.writeHead(405).end()
          return
        }
        const result = await stoweObservations()
        response.writeHead(result.status, Object.fromEntries(result.headers))
        response.end(await result.text())
      })
    },
  }],
})
