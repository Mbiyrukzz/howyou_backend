// backend/routes/createUserRoute.js
const { getCollections } = require('../db')

const createUserRoute = {
  method: 'post',
  path: '/users',
  handler: async (req, res) => {
    try {
      const { firebaseUid, email, name } = req.body
      const { users } = getCollections()

      const existing = await users.findOne({ firebaseUid })
      if (existing) {
        return res
          .status(400)
          .json({ success: false, error: 'User already exists' })
      }

      const result = await users.insertOne({
        firebaseUid,
        email,
        name,
        createdAt: new Date(),
        lastSeen: new Date(), // Add lastSeen
        online: false, // Initialize as offline
      })

      res.json({ success: true, userId: result.insertedId })
    } catch (err) {
      console.error('❌ Error creating user:', err)
      res.status(500).json({ success: false, error: 'Failed to create user' })
    }
  },
}

module.exports = { createUserRoute }
