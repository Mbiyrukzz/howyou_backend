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
      const currentUserId = req.user.uid

      if (!currentUserId) {
        return res
          .status(401)
          .json({ success: false, error: 'User not authenticated' })
      }

      const { chats, users } = getCollections()

      // ✅ Normalize all participants to Firebase UIDs
      const convertedParticipants = new Set([currentUserId])

      for (const participantId of participants) {
        const query = [{ firebaseUid: participantId }]
        if (ObjectId.isValid(participantId))
          query.push({ _id: new ObjectId(participantId) })

        const participantUser = await users.findOne({ $or: query })
        if (participantUser?.firebaseUid)
          convertedParticipants.add(participantUser.firebaseUid)
      }

      const finalParticipants = [...convertedParticipants]
      console.log('👥 Final participants:', finalParticipants)

      // ✅ Handle 1-on-1 chat duplicate prevention
      if (finalParticipants.length === 2 && !name) {
        // Fetch all 1-on-1 chats of the current user
        const userChats = await chats
          .find({ participants: currentUserId, isGroup: false })
          .toArray()

        // Compare arrays manually
        const existingChat = userChats.find((chat) => {
          if (chat.participants.length !== 2) return false
          const normalized = chat.participants.map(String).sort()
          const compareTo = [...finalParticipants].map(String).sort()
          return JSON.stringify(normalized) === JSON.stringify(compareTo)
        })

        if (existingChat) {
          console.log('💬 Existing chat found:', existingChat._id)
          return res.json({
            success: true,
            chat: existingChat,
            message: 'Chat already exists',
          })
        }
      }

      // ✅ Create new chat
      const newChat = {
        participants: finalParticipants,
        name: name || null,
        createdBy: currentUserId,
        createdAt: new Date(),
        lastActivity: new Date(),
        lastMessage: null,
        isGroup: finalParticipants.length > 2 || Boolean(name),
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
