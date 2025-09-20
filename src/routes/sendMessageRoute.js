const { getCollections } = require('../db')
const { verifyAuthToken } = require('../middleware/verifyAuthToken')

const sendMessageRoute = {
  path: '/send-message',
  method: 'post',
  middleware: [verifyAuthToken],
  handler: async (req, res) => {
    try {
      const { chatId, content } = req.body
      const { messages } = getCollections()

      const result = await messages.insertOne({
        chatId,
        senderId: req.user.uid, // ✅ from Firebase
        content,
        type: 'text',
        createdAt: new Date(),
      })

      res.json({ success: true, messageId: result.insertedId })
    } catch (err) {
      console.error('❌ Error saving message:', err)
      res.status(500).json({ success: false, error: 'Failed to send message' })
    }
  },
}

module.exports = { sendMessageRoute }
