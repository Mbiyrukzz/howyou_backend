const express = require('express')
const cors = require('cors')
const http = require('http')
const admin = require('firebase-admin')
const credentials = require('../credentials.json')
const { routes } = require('./routes')
const { initializeDbConnection } = require('./db')
const { setupSignalingServer } = require('./signalingServer')
const { setWebSocketClients } = require('./routes/initiateCallRoute')

// Initialize Firebase Admin
admin.initializeApp({
  credential: admin.credential.cert(credentials),
})

// Create Express app
const app = express()
app.use(cors())
app.use(express.json())

// Create HTTP server
const server = http.createServer(app)

// Setup signaling server and get client reference
const wsClients = setupSignalingServer(server)

// Pass WebSocket clients to call routes
if (wsClients) {
  setWebSocketClients(wsClients)
}

// Start server
const startServer = async () => {
  try {
    await initializeDbConnection()
    console.log('✅ Database connected')

    // Register all routes
    routes.forEach((route) => {
      if (route.middleware && route.middleware.length > 0) {
        app[route.method](route.path, ...route.middleware, route.handler)
        console.log(
          `✅ Registered ${route.method.toUpperCase()} ${
            route.path
          } with middleware`
        )
      } else {
        app[route.method](route.path, route.handler)
        console.log(`✅ Registered ${route.method.toUpperCase()} ${route.path}`)
      }
    })

    // Test endpoint
    app.get('/test', (req, res) => {
      res.send({ message: 'Backend is reachable 🚀' })
    })

    // Health check
    app.get('/health', (req, res) => {
      res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        websocket: wsClients ? 'connected' : 'disconnected',
      })
    })

    // Start server
    server.listen(5000, '0.0.0.0', () => {
      console.log('🚀 Server running on http://0.0.0.0:5000')
      console.log('📡 WebSocket signaling ready')
      console.log('\n📋 Registered routes:')
      routes.forEach((route) => {
        console.log(`  ${route.method.toUpperCase().padEnd(6)} ${route.path}`)
      })
    })
  } catch (err) {
    console.error('❌ Failed to start server:', err)
    process.exit(1)
  }
}

startServer()

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('⚠️ SIGTERM received, shutting down gracefully')
  server.close(() => {
    console.log('✅ Server closed')
    process.exit(0)
  })
})
