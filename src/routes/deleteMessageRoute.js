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
    console.log('Message details:', req.message)

    try {
      const { messages, chats } = getCollections()
      const messageId = req.params.messageId
      const chatId = req.message.chatId.toString()

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

      await chats.updateOne(
        { _id: new ObjectId(chatId) },
        {
          $set: {
            lastMessage: latestMessage
              ? latestMessage.content.substring(0, 50) || 'Media message'
              : 'No messages',
            lastActivity: new Date(),
          },
        }
      )

      // Notify other participants via WebSocket
      const chat = await chats.findOne({ _id: new ObjectId(chatId) })
      const participants = chat.participants.filter((p) => p !== req.user.uid)
      notifyChatParticipants(participants, {
        type: 'message_deleted',
        chatId,
        messageId,
      })

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
