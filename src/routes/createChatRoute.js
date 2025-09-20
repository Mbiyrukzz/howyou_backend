// createChatRoute.js
const { getCollections } = require('../db')
const { verifyAuthToken } = require('../middleware/verifyAuthToken')
const { ObjectId } = require('mongodb')

const createChatRoute = {
  path: '/create-chat',
  method: 'post',
  middleware: [verifyAuthToken],
  handler: async (req, res) => {
    try {
      const { participants = [], name } = req.body
      const currentUserId = req.user.uid // Firebase UID from middleware

      console.log('🔄 Creating chat:', { participants, name, currentUserId })

      if (!currentUserId) {
        console.log('❌ No user ID in request')
        return res
          .status(401)
          .json({ success: false, error: 'User not authenticated' })
      }

      const { chats } = getCollections()

      // Create participants array including current user
      const allParticipants = [...participants, currentUserId]

      // Remove duplicates
      const uniqueParticipants = [...new Set(allParticipants)]

      console.log('👥 Final participants:', uniqueParticipants)

      // For direct chats (2 participants), check if chat already exists
      if (uniqueParticipants.length === 2) {
        const existingChat = await chats.findOne({
          participants: { $all: uniqueParticipants, $size: 2 },
        })

        if (existingChat) {
          console.log('💬 Chat already exists:', existingChat._id)
          return res.json({
            success: true,
            chat: existingChat,
            message: 'Chat already exists',
          })
        }
      }

      // Create new chat
      const newChat = {
        participants: uniqueParticipants,
        name: name || null, // null for direct chats, name for group chats/rooms
        createdBy: currentUserId,
        createdAt: new Date(),
        lastActivity: new Date(),
        lastMessage: null,
        isGroup: uniqueParticipants.length > 2 || Boolean(name),
      }

      const result = await chats.insertOne(newChat)
      const createdChat = { ...newChat, _id: result.insertedId }

      console.log('✅ Chat created:', createdChat._id)

      res.json({
        success: true,
        chat: createdChat,
        message: 'Chat created successfully',
      })
    } catch (err) {
      console.error('❌ Error creating chat:', err)
      res.status(500).json({
        success: false,
        error: 'Failed to create chat',
        details: err.message,
      })
    }
  },
}

module.exports = { createChatRoute }
