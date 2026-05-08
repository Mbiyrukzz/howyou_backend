require('dotenv').config()

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

const uploadsPath = path.join(__dirname, '..', 'src', 'uploads')

app.use(
  '/uploads',
  (req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')
    res.setHeader('Accept-Ranges', 'bytes')

    const ext = path.extname(req.path).toLowerCase()
    if (ext === '.mp3') res.setHeader('Content-Type', 'audio/mpeg')
    if (ext === '.mp4') res.setHeader('Content-Type', 'video/mp4')

    next()
  },
  express.static(uploadsPath),
)

console.log('Uploads served from:', uploadsPath)

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
          } with middleware`,
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

    // Test endpoint
    app.get('/test-livekit', (req, res) => {
      try {
        const {
          generateCallTokens,
          validateConnection,
          LIVEKIT_URL,
        } = require('./services/livekitService')

        const isValid = validateConnection()

        if (!isValid) {
          return res.json({ success: false, error: 'Not configured' })
        }

        const tokens = generateCallTokens(
          'test-123',
          { uid: 'user1', name: 'Test User 1' },
          { uid: 'user2', name: 'Test User 2' },
        )

        res.json({
          success: true,
          url: LIVEKIT_URL,
          types: {
            caller: typeof tokens.callerToken,
            recipient: typeof tokens.recipientToken,
          },
          preview: {
            caller: tokens.callerToken.substring(0, 50),
            recipient: tokens.recipientToken.substring(0, 50),
          },
        })
      } catch (err) {
        res.json({
          success: false,
          error: err.message,
          stack: err.stack,
        })
      }
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
          files: files.slice(0, 10),
          sampleUrl: files[0]
            ? `${process.env.SERVER_BASE_URL}/uploads/images/${files[0]}`
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
          readyState: client.ws.readyState,
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
          try {
            client.ws.send(
              JSON.stringify({
                type: type || 'test-message',
                message: message || 'Test broadcast',
                timestamp: new Date().toISOString(),
              }),
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
    const PORT = process.env.PORT || 5000
    server.listen(PORT, '0.0.0.0', () => {
      console.log('\n╔════════════════════════════════════════╗')
      console.log(`║  Server running on http://0.0.0.0:${PORT} ║`)
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
