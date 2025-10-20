// routes/pushNotifications.js
const { getCollections } = require('../db')
const { verifyAuthToken } = require('../middleware/verifyAuthToken')
const { Expo } = require('expo-server-sdk')

// Initialize Expo SDK
const expo = new Expo()

// Save push token route
const savePushTokenRoute = {
  path: '/save-push-token',
  method: 'post',
  middleware: [verifyAuthToken],
  handler: async (req, res) => {
    try {
      const { pushToken, platform } = req.body
      const userId = req.user.uid

      console.log('💾 Save push token request:', {
        userId,
        platform,
        tokenPreview: pushToken?.substring(0, 20) + '...',
      })

      if (!pushToken) {
        return res.status(400).json({
          success: false,
          error: 'Push token is required',
        })
      }

      if (!Expo.isExpoPushToken(pushToken)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid Expo push token format',
        })
      }

      const { users } = getCollections()

      // Update user document with push token
      const result = await users.updateOne(
        { firebaseUid: userId },
        {
          $set: {
            pushToken,
            platform: platform || 'unknown',
            pushTokenUpdatedAt: new Date(),
          },
        }
      )

      if (result.matchedCount === 0) {
        return res.status(404).json({
          success: false,
          error: 'User not found',
        })
      }

      console.log('✅ Push token saved successfully for user:', userId)

      res.json({
        success: true,
        message: 'Push token saved successfully',
      })
    } catch (err) {
      console.error('❌ Error saving push token:', err)
      res.status(500).json({
        success: false,
        error: 'Failed to save push token',
        details: err.message,
      })
    }
  },
}

// Get push token for a user
const getPushTokenRoute = {
  path: '/get-push-token/:userId',
  method: 'get',
  middleware: [verifyAuthToken],
  handler: async (req, res) => {
    try {
      const { userId } = req.params
      const { users } = getCollections()

      const user = await users.findOne({ firebaseUid: userId })

      if (!user) {
        return res.status(404).json({
          success: false,
          error: 'User not found',
        })
      }

      res.json({
        success: true,
        pushToken: user.pushToken || null,
        platform: user.platform || null,
      })
    } catch (err) {
      console.error('❌ Error getting push token:', err)
      res.status(500).json({
        success: false,
        error: 'Failed to get push token',
        details: err.message,
      })
    }
  },
}

module.exports = {
  savePushTokenRoute,
  getPushTokenRoute,
}
