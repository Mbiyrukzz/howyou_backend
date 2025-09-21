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
      const currentUserId = req.user.uid

      console.log('🔍 Access check:', { chatId, currentUserId })

      const { messages, chats } = getCollections()

      // ✅ Simple check - Firebase UID in participants
      const chat = await chats.findOne({
        _id: new ObjectId(chatId),
        participants: currentUserId,
      })

      console.log('💬 Chat found:', chat ? 'Yes' : 'No')
      if (chat) {
        console.log('📝 Chat participants:', chat.participants)
      }

      if (!chat) {
        return res
          .status(403)
          .json({ success: false, error: 'Access denied to this chat' })
      }

      const chatMessages = await messages
        .find({ chatId: new ObjectId(chatId) })
        .sort({ createdAt: 1 })
        .toArray()

      console.log('📨 Messages found:', chatMessages.length)
      res.json(chatMessages)
    } catch (err) {
      console.error('❌ Error getting messages:', err)
      res.status(500).json({ success: false, error: 'Failed to get messages' })
    }
  },
}

module.exports = { listMessagesRoute }
