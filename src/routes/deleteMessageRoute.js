const { getCollections } = require('../db')
const { ObjectId } = require('mongodb')

const { verifyAuthToken } = require('../middleware/verifyAuthToken')
const { userOwnMessage } = require('../middleware/userOwnMessage')

const deleteMessageRoute = {
  path: '/delete-message/:messageId',
  method: 'delete',
  middleware: [verifyAuthToken, userOwnMessage],
  handler: async (req, res) => {
    console.log('userOwnMessage middleware LOADED')
    console.log('=== Delete Message Request ===')
    console.log('Message ID:', req.params.messageId)
    console.log('Current user:', req.user.uid)

    try {
      const { messages, chats } = getCollections()
      const messageId = req.params.messageId

      if (!ObjectId.isValid(messageId)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid message ID format',
        })
      }

      const message = req.message
      if (!message) {
        return res.status(404).json({
          success: false,
          error: 'Message not found',
        })
      }

      const chatId = message.chatId.toString()

      // ✅ Get chat BEFORE deleting message
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

      // Update chat's lastMessage
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

      // Send response first
      res.json({
        success: true,
        message: 'Message deleted successfully',
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
        `📡 Broadcasting message deletion to ${chat.participants.length} participants`
      )

      const broadcastPayload = {
        type: 'message-deleted',
        chatId,
        messageId,
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
            console.log(`  ✅ Deletion sent to ${participantId}`)
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
