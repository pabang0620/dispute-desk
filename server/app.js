import express from 'express'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { api, errorHandler } from './routes.js'

export function createApp() {
  const app = express()
  const distDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist')
  app.disable('x-powered-by')
  // Behind a reverse proxy on the same host (hosting): req.secure and req.ip come from X-Forwarded-*. TRUST_PROXY overrides.
  app.set('trust proxy', process.env.TRUST_PROXY || 'loopback')
  app.use(express.json({ limit: '2mb' }))
  app.use('/api', api)
  if (existsSync(distDir)) {
    app.use(express.static(distDir))
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api')) return next()
      res.sendFile(path.join(distDir, 'index.html'))
    })
  }
  app.use(errorHandler)
  return app
}
