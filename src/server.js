const express = require('express')
const cors = require('cors')
const admin = require('firebase-admin')
const credentials = require('../credentials.json')
const { routes } = require('./routes')
const { initializeDbConnection } = require('./db')

admin.initializeApp({
  credential: admin.credential.cert(credentials),
})

const app = express()
app.use(cors())
app.use(express.json())

// Attach routes only after DB connects
const startServer = async () => {
  try {
    await initializeDbConnection() // ✅ wait for DB ready

    // FIXED: Properly register routes with middleware
    routes.forEach((route) => {
      if (route.middleware && route.middleware.length > 0) {
        // Apply middleware if exists
        app[route.method](route.path, ...route.middleware, route.handler)
        console.log(
          `✅ Registered ${route.method.toUpperCase()} ${
            route.path
          } with middleware`
        )
      } else {
        // No middleware
        app[route.method](route.path, route.handler)
        console.log(`✅ Registered ${route.method.toUpperCase()} ${route.path}`)
      }
    })

    app.get('/test', (req, res) => {
      res.send({ message: 'Backend is reachable 🚀' })
    })

    app.listen(5000, '0.0.0.0', () => {
      console.log('Server running at http://0.0.0.0:5000')
      console.log('Routes registered:')
      routes.forEach((route) => {
        console.log(`  ${route.method.toUpperCase()} ${route.path}`)
      })
    })
  } catch (err) {
    console.error('❌ Failed to start server:', err)
    process.exit(1)
  }
}

startServer()
