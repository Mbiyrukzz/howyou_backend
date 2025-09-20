// getMessagesRoute.js
const { getCollections } = require('../db')
const { verifyAuthToken } = require('../middleware/verifyAuthToken')
const { ObjectId } = require('mongodb')

const listMessagesRoute = {
  path: '/get-messages/:chatId',
  method: 'get',
  middleware: [verifyAuthToken],
  handler: async (req, res) => {
    try {
      const { chatId } = req.params
      if (!chatId) {
        return res
          .status(400)
          .json({ success: false, error: 'chatId required' })
      }

      const { messages, chats } = getCollections()

      // Verify user has access to this chat
      const chat = await chats.findOne({
        _id: new ObjectId(chatId),
        participants: req.user.uid,
      })

      if (!chat) {
        return res
          .status(403)
          .json({ success: false, error: 'Access denied to this chat' })
      }

      // Get all messages for this chat, sorted by creation time
      const chatMessages = await messages
        .find({ chatId: new ObjectId(chatId) })
        .sort({ createdAt: 1 })
        .toArray()

      res.json(chatMessages)
    } catch (err) {
      console.error('❌ Error getting messages:', err)
      res.status(500).json({ success: false, error: 'Failed to get messages' })
    }
  },
}

module.exports = { listMessagesRoute }
