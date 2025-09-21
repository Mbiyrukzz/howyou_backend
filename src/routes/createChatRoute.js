// createChatRoute.js - FIXED VERSION
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

      const { chats, users } = getCollections()

      // ✅ IMPORTANT: Convert ALL participant IDs to Firebase UIDs
      const convertedParticipants = []

      // Add current user (already Firebase UID)
      convertedParticipants.push(currentUserId)

      // Convert other participants to Firebase UIDs
      for (const participantId of participants) {
        // Check if it's already a Firebase UID or if it's a MongoDB ObjectId
        const participantUser = await users.findOne({
          $or: [
            { firebaseUid: participantId }, // Already Firebase UID
            { _id: new ObjectId(participantId) }, // MongoDB ObjectId
          ],
        })

        if (participantUser && participantUser.firebaseUid) {
          // Add Firebase UID to participants
          if (!convertedParticipants.includes(participantUser.firebaseUid)) {
            convertedParticipants.push(participantUser.firebaseUid)
          }
        }
      }

      console.log(
        '👥 Final participants (Firebase UIDs):',
        convertedParticipants
      )

      // For direct chats (2 participants), check if chat already exists
      if (convertedParticipants.length === 2 && !name) {
        const existingChat = await chats.findOne({
          participants: { $all: convertedParticipants, $size: 2 },
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

      // Create new chat with Firebase UIDs only
      const newChat = {
        participants: convertedParticipants, // ✅ All Firebase UIDs
        name: name || null,
        createdBy: currentUserId,
        createdAt: new Date(),
        lastActivity: new Date(),
        lastMessage: null,
        isGroup: convertedParticipants.length > 2 || Boolean(name),
      }

      const result = await chats.insertOne(newChat)
      const createdChat = { ...newChat, _id: result.insertedId }

      console.log('✅ Chat created with participants:', convertedParticipants)

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
