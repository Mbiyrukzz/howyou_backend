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

      // ✅ FIXED: Proper deletion logic
      // - For 1-on-1 chats (!isGroup): any participant can delete
      // - For group chats (isGroup): only the creator can delete
      let canDelete = false
      let reason = ''

      if (!chat.isGroup) {
        // 1-on-1 chat - any participant can delete
        canDelete = chat.participants.includes(currentUserId)
        reason = '1-on-1 chat, participant can delete'
      } else {
        // Group chat - only creator can delete
        canDelete = chat.createdBy === currentUserId
        reason =
          chat.createdBy === currentUserId
            ? 'Group chat, user is creator'
            : 'Group chat, user is not creator'
      }

      console.log('  Can delete?', canDelete)
      console.log('  Reason:', reason)
      console.log('  Is group?', chat.isGroup)
      console.log('  Created by:', chat.createdBy)
      console.log('  Current user:', currentUserId)
      console.log('  Participants:', chat.participants)

      if (!canDelete) {
        return res.status(403).json({
          success: false,
          error: chat.isGroup
            ? 'Only the chat creator can delete group chats'
            : 'You do not have permission to delete this chat',
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
