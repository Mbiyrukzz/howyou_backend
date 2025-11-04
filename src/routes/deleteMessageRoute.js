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

      // Get message details (from middleware)
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

      // Update chat's lastMessage if this was the most recent message
      const latestMessage = await messages.findOne(
        { chatId: new ObjectId(chatId) },
        { sort: { createdAt: -1 } }
      )

      if (latestMessage) {
        await chats.updateOne(
          { _id: new ObjectId(chatId) },
          {
            $set: {
              lastMessage: latestMessage.content
                ? latestMessage.content.substring(0, 50)
                : 'Sent an attachment',
              lastActivity: latestMessage.createdAt,
            },
          }
        )
      } else {
        // No messages left in chat
        await chats.updateOne(
          { _id: new ObjectId(chatId) },
          {
            $set: {
              lastMessage: '',
              lastActivity: new Date(),
            },
          }
        )
      }

      // Get chat to broadcast to participants
      const chat = await chats.findOne({ _id: new ObjectId(chatId) })

      res.json({
        success: true,
        message: 'Message deleted successfully',
      })

      // ✅ Broadcast via WebSocket
      if (chat && global.wsClients) {
        console.log(`📡 Broadcasting message deletion to chat ${chatId}`)

        chat.participants.forEach((participantId) => {
          const client = global.wsClients.get(participantId)
          if (client && client.ws.readyState === 1) {
            // 1 = OPEN
            client.ws.send(
              JSON.stringify({
                type: 'message-deleted',
                chatId,
                messageId,
                timestamp: new Date().toISOString(),
              })
            )
            console.log(`✉️ Sent deletion notification to ${participantId}`)
          }
        })
      }
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
