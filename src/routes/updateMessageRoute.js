const { getCollections } = require('../db')
const { ObjectId } = require('mongodb')
const { userOwnMessage } = require('../middleware/userOwnMessage')
const { verifyAuthToken } = require('../middleware/verifyAuthToken')

const updateMessageRoute = {
  path: '/update-message/:messageId',
  method: 'put',
  middleware: [verifyAuthToken, userOwnMessage],
  handler: async (req, res) => {
    console.log('=== Update Message Request ===')
    console.log('Message ID:', req.params.messageId)
    console.log('Current user:', req.user.uid)
    console.log('New content:', req.body.content)

    try {
      const { messages, chats } = getCollections()
      const messageId = req.params.messageId
      const { content } = req.body

      // Validate ObjectId
      if (!ObjectId.isValid(messageId)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid message ID format',
        })
      }

      // Validate content
      if (!content || typeof content !== 'string' || !content.trim()) {
        return res.status(400).json({
          success: false,
          error: 'Content is required and must be a non-empty string',
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

      // Check if message is text type (can't edit media messages)
      if (message.type !== 'text') {
        return res.status(400).json({
          success: false,
          error: 'Only text messages can be edited',
        })
      }

      const chatId = message.chatId.toString()
      const trimmedContent = content.trim()

      // Update the message
      const updateResult = await messages.updateOne(
        { _id: new ObjectId(messageId) },
        {
          $set: {
            content: trimmedContent,
            updatedAt: new Date(),
          },
        }
      )

      if (updateResult.matchedCount === 0) {
        console.error('❌ Message not found for update:', messageId)
        return res.status(404).json({
          success: false,
          error: 'Message not found',
        })
      }

      console.log(`✅ Message updated successfully: ${messageId}`)

      // Get the updated message
      const updatedMessage = await messages.findOne({
        _id: new ObjectId(messageId),
      })

      // Update chat's lastMessage if this was the most recent message
      const latestMessage = await messages.findOne(
        { chatId: new ObjectId(chatId) },
        { sort: { createdAt: -1 } }
      )

      if (latestMessage && latestMessage._id.toString() === messageId) {
        await chats.updateOne(
          { _id: new ObjectId(chatId) },
          {
            $set: {
              lastMessage: trimmedContent.substring(0, 50),
              lastActivity: new Date(),
            },
          }
        )
      }

      // Optional: WebSocket notification for real-time updates
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
                type: 'message_updated',
                chatId,
                messageId,
                content: trimmedContent,
              })
            )
          }
        })
      }

      res.json({
        success: true,
        message: 'Message updated successfully',
        data: {
          _id: updatedMessage._id,
          content: updatedMessage.content,
          updatedAt: updatedMessage.updatedAt,
          chatId: updatedMessage.chatId,
          senderId: updatedMessage.senderId,
          type: updatedMessage.type,
          createdAt: updatedMessage.createdAt,
        },
      })
    } catch (err) {
      console.error('❌ Error updating message:', err)
      res.status(500).json({
        success: false,
        error: 'Failed to update message',
        details: err.message,
      })
    }
  },
}

module.exports = { updateMessageRoute }
