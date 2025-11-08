const express = require('express')
const cors = require('cors')
const http = require('http')
const admin = require('firebase-admin')
const path = require('path')
const multer = require('multer')

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

app.use('/uploads', express.static(path.join(__dirname, 'uploads')))

// Create HTTP server
const server = http.createServer(app)

// Setup signaling server and get client reference
const { wsClients, notificationClients, postsClients, signalingClients } =
  setupSignalingServer(server)

// ========================================
// CRITICAL FIX: Attach wsClients to app
// ========================================
app.wsClients = wsClients // ← Make available to all routes via req.app.wsClients

global.notificationClients = notificationClients
global.postsClients = postsClients
global.signalingClients = signalingClients
// Also set globally for backwards compatibility
global.wsClients = wsClients

console.log('✅ WebSocket clients initialized')
console.log('   - app.wsClients:', !!app.wsClients)
console.log('   - global.wsClients:', !!global.wsClients)
console.log('   - Clients Map size:', wsClients.size)

// Pass WebSocket clients to call routes
if (wsClients) {
  setWebSocketClients(wsClients)
}

// ========================================
// Middleware to ensure wsClients available in all routes
// ========================================
app.use((req, res, next) => {
  // Double-check wsClients is available
  if (!req.app.wsClients) {
    console.warn('⚠️ wsClients not found on req.app, attaching...')
    req.app.wsClients = wsClients
  }
  next()
})

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

    app.get('/debug-uploads', (req, res) => {
      const fs = require('fs')
      const uploadsPath = path.join(__dirname, 'uploads')

      try {
        const imagesPath = path.join(uploadsPath, 'images')
        const files = fs.readdirSync(imagesPath)

        res.json({
          uploadsPath,
          imagesPath,
          filesCount: files.length,
          files: files.slice(0, 10), // Show first 10 files
          sampleUrl: files[0]
            ? `http://localhost:5000/uploads/images/${files[0]}`
            : 'No files',
        })
      } catch (err) {
        res.json({
          error: err.message,
          uploadsPath,
        })
      }
    })

    // Health check
    app.get('/health', (req, res) => {
      res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        websocket: wsClients ? 'connected' : 'disconnected',
      })
    })

    // ========================================
    // WebSocket Status Endpoint - For debugging
    // ========================================
    app.get('/ws-status', (req, res) => {
      const connectedClients = Array.from(wsClients.keys())

      res.json({
        status: 'ok',
        wsClients: {
          available: !!wsClients,
          onAppObject: !!app.wsClients,
          totalConnected: wsClients.size,
          connectedUsers: connectedClients,
        },
        details: Array.from(wsClients.entries()).map(([userId, client]) => ({
          userId,
          online: client.online,
          pathname: client.pathname,
          connectedAt: client.connectedAt,
          lastActivity: client.lastActivity,
          readyState: client.ws.readyState, // 0=CONNECTING, 1=OPEN, 2=CLOSING, 3=CLOSED
        })),
      })
    })

    // ========================================
    // Test Broadcasting Endpoint - For debugging
    // ========================================
    app.post('/test-broadcast', (req, res) => {
      const { type, message } = req.body

      if (!wsClients || wsClients.size === 0) {
        return res.json({
          success: false,
          error: 'No WebSocket clients connected',
        })
      }

      let broadcastCount = 0
      let failedCount = 0

      wsClients.forEach((client, userId) => {
        if (client.ws.readyState === 1) {
          // OPEN
          try {
            client.ws.send(
              JSON.stringify({
                type: type || 'test-message',
                message: message || 'Test broadcast',
                timestamp: new Date().toISOString(),
              })
            )
            broadcastCount++
            console.log(`✅ Test broadcast sent to: ${userId}`)
          } catch (err) {
            failedCount++
            console.error(`❌ Failed to send to ${userId}:`, err.message)
          }
        }
      })

      res.json({
        success: true,
        broadcastCount,
        failedCount,
        totalClients: wsClients.size,
      })
    })

    // Start server
    server.listen(5000, '0.0.0.0', () => {
      console.log('\n╔════════════════════════════════════════╗')
      console.log('║  Server running on http://0.0.0.0:5000 ║')
      console.log('║  WebSocket signaling ready             ║')
      console.log('╚════════════════════════════════════════╝\n')

      console.log('📡 WebSocket Status:')
      console.log(`   - Clients initialized: ${!!wsClients}`)
      console.log(`   - Available on app: ${!!app.wsClients}`)
      console.log(`   - Initial connections: ${wsClients.size}\n`)

      console.log('🧪 Debug Endpoints:')
      console.log('   - GET  /ws-status       - Check WebSocket status')
      console.log('   - POST /test-broadcast  - Test message broadcasting')
      console.log('   - GET  /health          - Health check\n')

      console.log('📋 Registered routes:')
      routes.forEach((route) => {
        console.log(`   ${route.method.toUpperCase().padEnd(6)} ${route.path}`)
      })
      console.log('')
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
