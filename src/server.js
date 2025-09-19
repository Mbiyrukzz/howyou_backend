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

    routes.forEach((route) => {
      app[route.method](route.path, route.handler)
    })

    app.listen(5000, () => console.log('✅ Server running on port 5000'))
  } catch (err) {
    console.error('❌ Failed to start server:', err)
    process.exit(1)
  }
}

startServer()
