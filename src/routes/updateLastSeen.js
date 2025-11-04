const { getCollections } = require('../db')
const { verifyAuthToken } = require('../middleware/verifyAuthToken')
const { ObjectId } = require('mongodb')

const updateLastSeenRoute = {
  path: '/update-last-seen/:chatId',
  method: 'post',
  middleware: [verifyAuthToken],
  handler: async (req, res) => {
    try {
      const { chatId } = req.params
      const userId = req.user.uid

      const { chats, users } = getCollections()

      // Verify user has access to this chat
      const chat = await chats.findOne({
        _id: new ObjectId(chatId),
        participants: userId,
      })

      if (!chat) {
        return res.status(403).json({
          success: false,
          error: 'Access denied to this chat',
        })
      }

      const now = new Date()

      // ✅ Update in users collection (global last seen)
      await users.updateOne(
        { firebaseUid: userId },
        {
          $set: {
            lastSeen: now,
            [`lastSeenPerChat.${chatId}`]: now, // Optional: per-chat tracking
          },
        }
      )

      // Also update in chats collection for backward compatibility
      await chats.updateOne(
        { _id: new ObjectId(chatId) },
        {
          $set: {
            [`lastSeen.${userId}`]: now,
          },
        }
      )

      console.log(`👁️ Updated last seen for user ${userId} in chat ${chatId}`)

      res.json({
        success: true,
        timestamp: now,
      })
    } catch (err) {
      console.error('❌ Error updating last seen:', err)
      res.status(500).json({
        success: false,
        error: 'Failed to update last seen',
      })
    }
  },
}

module.exports = { updateLastSeenRoute }
