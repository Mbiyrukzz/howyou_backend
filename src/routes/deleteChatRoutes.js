const { getCollections } = require('../db')
const { verifyAuthToken } = require('../middleware/verifyAuthToken')
const { userOwnChat } = require('../middleware/userOwnChat')
const { ObjectId } = require('mongodb')

const deleteChatRoute = {
  path: '/delete-chat/:chatId',
  method: 'delete',
  middleware: [verifyAuthToken, userOwnChat],
  handler: async (req, res) => {
    console.log('🗑️ Delete chat handler called')
    console.log('  Params:', req.params)
    console.log('  User:', req.user?.uid)
    console.log('  Chat:', req.chat?._id)

    try {
      const { chatId } = req.params
      const currentUserId = req.user.uid
      const chat = req.chat // Attached by userOwnChat middleware

      if (!chat) {
        console.error('❌ No chat found in req.chat')
        return res.status(400).json({
          success: false,
          error: 'Chat not found in request',
        })
      }

      const { chats, messages } = getCollections()

      // Additional check: Only allow deletion if user is the creator or it's a 1-on-1 chat
      const canDelete =
        chat.createdBy === currentUserId || // User created the chat
        (!chat.isGroup && chat.participants.length === 2) // 1-on-1 chat

      console.log('  Can delete?', canDelete)
      console.log(
        '  Reason: createdBy =',
        chat.createdBy,
        ', currentUser =',
        currentUserId
      )
      console.log(
        '  Is group?',
        chat.isGroup,
        ', participants:',
        chat.participants.length
      )

      if (!canDelete) {
        return res.status(403).json({
          success: false,
          error: 'Only the chat creator can delete group chats',
        })
      }

      const chatObjectId = ObjectId.isValid(chatId)
        ? new ObjectId(chatId)
        : chatId

      console.log('  Deleting messages for chat:', chatObjectId)

      // Delete all messages in the chat
      const messagesDeleted = await messages.deleteMany({
        chatId: chatObjectId,
      })
      console.log(`🗑️ Deleted ${messagesDeleted.deletedCount} messages`)

      // Delete the chat itself
      const chatDeleted = await chats.deleteOne({
        _id: chatObjectId,
      })

      if (chatDeleted.deletedCount === 0) {
        console.error('❌ Chat not found for deletion')
        return res.status(404).json({
          success: false,
          error: 'Chat not found',
        })
      }

      console.log(`✅ Chat ${chatId} deleted by user ${currentUserId}`)

      res.json({
        success: true,
        message: 'Chat deleted successfully',
        deletedMessagesCount: messagesDeleted.deletedCount,
      })
    } catch (err) {
      console.error('❌ Error deleting chat:', err)
      console.error('Stack:', err.stack)
      res.status(500).json({
        success: false,
        error: 'Failed to delete chat',
        details: err.message,
      })
    }
  },
}

module.exports = { deleteChatRoute }
