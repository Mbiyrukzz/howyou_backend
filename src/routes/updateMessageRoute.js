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

      if (!ObjectId.isValid(messageId)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid message ID format',
        })
      }

      if (!content || typeof content !== 'string' || !content.trim()) {
        return res.status(400).json({
          success: false,
          error: 'Content is required and must be a non-empty string',
        })
      }

      const message = req.message
      if (!message) {
        return res.status(404).json({
          success: false,
          error: 'Message not found',
        })
      }

      if (message.type !== 'text') {
        return res.status(400).json({
          success: false,
          error: 'Only text messages can be edited',
        })
      }

      const chatId = message.chatId.toString()
      const trimmedContent = content.trim()
      const now = new Date()

      // ✅ Get chat BEFORE updating (for participants)
      const chat = await chats.findOne({ _id: new ObjectId(chatId) })

      // ✅ ADD DEBUG LOGGING
      console.log('📊 Debug Info:')
      console.log('  - Chat found:', !!chat)
      console.log('  - Chat participants:', chat?.participants)
      console.log('  - global.wsClients exists:', !!global.wsClients)
      console.log('  - wsClients size:', global.wsClients?.size)

      if (chat && global.wsClients) {
        console.log('  - Connected users:', Array.from(global.wsClients.keys()))
      }

      if (!chat) {
        return res.status(404).json({
          success: false,
          error: 'Chat not found',
        })
      }

      // Update the message
      const updateResult = await messages.updateOne(
        { _id: new ObjectId(messageId) },
        {
          $set: {
            content: trimmedContent,
            updatedAt: now,
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
              lastActivity: now,
            },
          }
        )
      }

      // Send response first
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

      // ✅ BROADCAST VIA WEBSOCKET
      if (!global.wsClients) {
        console.error('❌ global.wsClients is not initialized!')
        return
      }

      if (!chat.participants || chat.participants.length === 0) {
        console.error('❌ Chat has no participants!')
        return
      }

      console.log(
        `📡 Broadcasting message update to ${chat.participants.length} participants`
      )

      const broadcastPayload = {
        type: 'message-updated',
        chatId,
        messageId,
        message: {
          _id: updatedMessage._id,
          content: updatedMessage.content,
          updatedAt: updatedMessage.updatedAt,
          chatId: updatedMessage.chatId,
          senderId: updatedMessage.senderId,
          type: updatedMessage.type,
          createdAt: updatedMessage.createdAt,
        },
        senderId: req.user.uid,
        timestamp: new Date().toISOString(),
      }

      let sentCount = 0
      let failedCount = 0

      chat.participants.forEach((participantId) => {
        const client = global.wsClients.get(participantId)

        console.log(`  📤 Attempting to send to ${participantId}:`, {
          clientExists: !!client,
          wsExists: !!client?.ws,
          readyState: client?.ws?.readyState,
        })

        if (client && client.ws && client.ws.readyState === 1) {
          try {
            client.ws.send(JSON.stringify(broadcastPayload))
            sentCount++
            console.log(`  ✅ Update sent to ${participantId}`)
          } catch (sendError) {
            failedCount++
            console.error(
              `  ❌ Failed to send to ${participantId}:`,
              sendError.message
            )
          }
        } else {
          failedCount++
          console.warn(
            `  ⚠️ Client ${participantId} not connected or socket not ready`
          )
        }
      })

      console.log(
        `📊 Broadcast complete: ${sentCount} sent, ${failedCount} failed`
      )
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
