const { getCollections } = require('../db')
const { ObjectId } = require('mongodb')
const { userOwnMessage } = require('../middleware/userOwnMessage')
const { verifyAuthToken } = require('../middleware/verifyAuthToken')

const deleteMessageRoute = {
  path: '/delete-message/:messageId',
  method: 'delete',
  middleware: [verifyAuthToken, userOwnMessage],
  handler: async (req, res) => {
    console.log('=== Delete Message Request ===')
    console.log('Message ID:', req.params.messageId)
    console.log('Current user:', req.user.uid)

    try {
      const { messages, chats } = getCollections()
      const messageId = req.params.messageId

      // Validate ObjectId
      if (!ObjectId.isValid(messageId)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid message ID format',
        })
      }

      // Get message details before deletion (from middleware)
      const message = req.message
      if (!message) {
        return res.status(404).json({
          success: false,
          error: 'Message not found',
        })
      }

      const chatId = message.chatId.toString()

      // Delete the message
      const deleteResult = await messages.deleteOne({
        _id: new ObjectId(messageId),
      })

      if (deleteResult.deletedCount === 0) {
        console.error('❌ Message not found for deletion:', messageId)
        return res.status(404).json({
          success: false,
          error: 'Message not found',
        })
      }

      console.log(`✅ Message deleted successfully: ${messageId}`)

      // Update chat's lastMessage to the most recent message
      const latestMessage = await messages.findOne(
        { chatId: new ObjectId(chatId) },
        { sort: { createdAt: -1 } }
      )

      const updateData = {
        lastActivity: new Date(),
      }

      if (latestMessage) {
        updateData.lastMessage = latestMessage.content
          ? latestMessage.content.substring(0, 50)
          : 'Media message'
      } else {
        updateData.lastMessage = 'No messages'
      }

      await chats.updateOne({ _id: new ObjectId(chatId) }, { $set: updateData })

      const chat = await chats.findOne({ _id: new ObjectId(chatId) })
      if (chat && global.wsConnections) {
        const participants = chat.participants.filter((p) => p !== req.user.uid)

        // Notify via WebSocket if available
        participants.forEach((participantId) => {
          const connection = global.wsConnections.get(participantId)
          if (connection && connection.readyState === 1) {
            // 1 = OPEN
            connection.send(
              JSON.stringify({
                type: 'message_deleted',
                chatId,
                messageId,
              })
            )
          }
        })
      }

      res.json({
        success: true,
        message: 'Message deleted successfully',
        deletedMessageId: messageId,
      })
    } catch (err) {
      console.error('❌ Error deleting message:', err)
      res.status(500).json({
        success: false,
        error: 'Failed to delete message',
        details: err.message,
      })
    }
  },
}

module.exports = { deleteMessageRoute }
