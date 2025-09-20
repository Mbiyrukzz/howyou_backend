// sendMessageRoute.js
const { getCollections } = require('../db')
const { verifyAuthToken } = require('../middleware/verifyAuthToken')
const { ObjectId } = require('mongodb')

const sendMessageRoute = {
  path: '/send-message',
  method: 'post',
  middleware: [verifyAuthToken],
  handler: async (req, res) => {
    try {
      const { chatId, content } = req.body
      if (!chatId || !content?.trim()) {
        return res
          .status(400)
          .json({ success: false, error: 'chatId and content required' })
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

      const newMessage = {
        chatId: new ObjectId(chatId),
        senderId: req.user.uid, // Firebase UID
        content: content.trim(),
        type: 'text',
        createdAt: new Date(),
      }

      const result = await messages.insertOne(newMessage)

      // Update chat's lastMessage and lastActivity
      await chats.updateOne(
        { _id: new ObjectId(chatId) },
        {
          $set: {
            lastMessage: content.trim(),
            lastActivity: new Date(),
          },
        }
      )

      res.json({
        success: true,
        message: { ...newMessage, _id: result.insertedId },
      })
    } catch (err) {
      console.error('❌ Error saving message:', err)
      res.status(500).json({ success: false, error: 'Failed to send message' })
    }
  },
}

module.exports = { sendMessageRoute }
