// listChatsRoute.js
const { getCollections } = require('../db')
const { verifyAuthToken } = require('../middleware/verifyAuthToken')

const listChatsRoute = {
  path: '/list-chats',
  method: 'get',
  middleware: [verifyAuthToken],
  handler: async (req, res) => {
    try {
      const currentUserId = req.user.uid
      console.log('🔄 Loading chats for user:', currentUserId)

      if (!currentUserId) {
        return res
          .status(401)
          .json({ success: false, error: 'User not authenticated' })
      }

      const { chats } = getCollections()

      // Find all chats where the current user is a participant
      const userChats = await chats
        .find({
          participants: currentUserId,
        })
        .sort({ lastActivity: -1 }) // Latest activity first
        .toArray()

      console.log('✅ Found chats:', userChats.length)

      res.json(userChats)
    } catch (error) {
      console.error('❌ Error fetching chats:', error)
      res.status(500).json({ success: false, error: 'Failed to fetch chats' })
    }
  },
}

module.exports = { listChatsRoute }
