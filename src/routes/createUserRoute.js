// backend/routes/createUserRoute.js
const { getCollections } = require('../db')
const { verifyAuthToken } = require('../middleware/verifyAuthToken')

const createUserRoute = {
  path: '/users',
  method: 'post',
  middleware: [verifyAuthToken],
  handler: async (req, res) => {
    try {
      const { name, phoneNumber, email } = req.body
      const firebaseUid = req.user.uid

      const { users } = getCollections()

      // Check if user already exists
      const existingUser = await users.findOne({ firebaseUid })
      if (existingUser) {
        return res.json({
          success: true,
          user: existingUser,
          message: 'User already exists',
        })
      }

      // Validate phone number format (optional)
      if (phoneNumber && !/^\+?[1-9]\d{1,14}$/.test(phoneNumber)) {
        return res.status(400).json({
          success: false,
          error:
            'Invalid phone number format. Use international format (e.g., +1234567890)',
        })
      }

      // Check if phone number or email already in use
      if (phoneNumber) {
        const phoneExists = await users.findOne({ phoneNumber })
        if (phoneExists) {
          return res.status(400).json({
            success: false,
            error: 'Phone number already registered',
          })
        }
      }

      if (email) {
        const emailExists = await users.findOne({
          email: email.toLowerCase(),
        })
        if (emailExists) {
          return res.status(400).json({
            success: false,
            error: 'Email already registered',
          })
        }
      }

      // Create new user
      const newUser = {
        firebaseUid,
        name: name || req.user.displayName || 'User',
        email: (email || req.user.email)?.toLowerCase(),
        phoneNumber: phoneNumber || null,
        displayName: req.user.displayName || name,
        photoURL: req.user.photoURL || null,
        online: true,
        lastSeen: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      const result = await users.insertOne(newUser)

      console.log('✅ User created:', firebaseUid)

      res.json({
        success: true,
        user: { ...newUser, _id: result.insertedId },
        message: 'User created successfully',
      })
    } catch (err) {
      console.error('❌ Error creating user:', err)
      res.status(500).json({
        success: false,
        error: 'Failed to create user',
        details: err.message,
      })
    }
  },
}

// Update user profile (including phone number)
const updateUserRoute = {
  path: '/users/:userId',
  method: 'put',
  middleware: [verifyAuthToken],
  handler: async (req, res) => {
    try {
      const { userId } = req.params
      const { name, phoneNumber, bio } = req.body

      if (req.user.uid !== userId) {
        return res.status(403).json({
          success: false,
          error: 'You can only update your own profile',
        })
      }

      const { users } = getCollections()

      // If updating phone number, check if it's already in use
      if (phoneNumber) {
        const phoneExists = await users.findOne({
          phoneNumber,
          firebaseUid: { $ne: userId },
        })
        if (phoneExists) {
          return res.status(400).json({
            success: false,
            error: 'Phone number already in use',
          })
        }
      }

      const updateData = {
        updatedAt: new Date(),
      }

      if (name) updateData.name = name
      if (phoneNumber !== undefined) updateData.phoneNumber = phoneNumber
      if (bio !== undefined) updateData.bio = bio

      const result = await users.updateOne(
        { firebaseUid: userId },
        { $set: updateData }
      )

      if (result.matchedCount === 0) {
        return res.status(404).json({
          success: false,
          error: 'User not found',
        })
      }

      const updatedUser = await users.findOne({ firebaseUid: userId })

      res.json({
        success: true,
        user: updatedUser,
        message: 'Profile updated successfully',
      })
    } catch (err) {
      console.error('❌ Error updating user:', err)
      res.status(500).json({
        success: false,
        error: 'Failed to update user',
      })
    }
  },
}

module.exports = {
  createUserRoute,
  updateUserRoute,
}
