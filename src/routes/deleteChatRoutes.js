// ============================================================================
// DELETE CHAT ROUTE (delete-chat.js) - WITH REAL-TIME BROADCASTING
// ============================================================================
const { getCollections } = require('../db')
const { verifyAuthToken } = require('../middleware/verifyAuthToken')
const { ObjectId } = require('mongodb')

const deleteChatRoute = {
  path: '/delete-chat/:chatId',
  method: 'delete',
  middleware: [verifyAuthToken],
  handler: async (req, res) => {
    try {
      const { chatId } = req.params
      const currentUserId = req.user.uid

      if (!currentUserId) {
        return res
          .status(401)
          .json({ success: false, error: 'User not authenticated' })
      }

      if (!ObjectId.isValid(chatId)) {
        return res
          .status(400)
          .json({ success: false, error: 'Invalid chat ID' })
      }

      const { chats, messages } = getCollections()

      // ✅ Find the chat first to get participants
      const chat = await chats.findOne({ _id: new ObjectId(chatId) })

      if (!chat) {
        return res.status(404).json({ success: false, error: 'Chat not found' })
      }

      // ✅ Verify user is a participant
      if (!chat.participants.includes(currentUserId)) {
        return res
          .status(403)
          .json({ success: false, error: 'Not authorized to delete this chat' })
      }

      console.log('🗑️ Deleting chat:', {
        chatId,
        deletedBy: currentUserId,
        participants: chat.participants,
      })

      // ✅ Delete the chat
      const deleteResult = await chats.deleteOne({ _id: new ObjectId(chatId) })

      if (deleteResult.deletedCount === 0) {
        return res
          .status(500)
          .json({ success: false, error: 'Failed to delete chat' })
      }

      // ✅ Delete all messages in the chat
      await messages.deleteMany({ chatId })

      console.log('✅ Chat and messages deleted successfully')

      // ✅ REAL-TIME: Broadcast chat deletion to all participants
      const wsClients = req.app.get('wsClients')
      if (wsClients) {
        console.log(
          '📡 Broadcasting chat deletion to participants:',
          chat.participants
        )

        chat.participants.forEach((participantId) => {
          // Don't send to the deleter - they'll get it in the response
          if (participantId === currentUserId) return

          const client = wsClients.get(participantId)
          if (client && client.ws.readyState === 1) {
            try {
              client.ws.send(
                JSON.stringify({
                  type: 'chat-deleted',
                  chatId,
                  deletedBy: currentUserId,
                  timestamp: new Date().toISOString(),
                })
              )
              console.log(
                `✅ Sent chat-deleted notification to ${participantId}`
              )
            } catch (err) {
              console.error(
                `❌ Failed to send chat-deleted to ${participantId}:`,
                err.message
              )
            }
          } else {
            console.log(`⚠️ User ${participantId} not connected`)
          }
        })
      } else {
        console.warn('⚠️ WebSocket clients not available')
      }

      res.json({
        success: true,
        message: 'Chat deleted successfully',
        chatId,
      })
    } catch (err) {
      console.error('❌ Error deleting chat:', err)
      res.status(500).json({
        success: false,
        error: 'Failed to delete chat',
        details: err.message,
      })
    }
  },
}

module.exports = { deleteChatRoute }
