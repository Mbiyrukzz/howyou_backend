const { getCollections } = require('../db')
const { verifyAuthToken } = require('../middleware/verifyAuthToken')
const { ObjectId } = require('mongodb')

const createChatRoute = {
  method: 'post',
  path: '/create-chat',
  middleware: [verifyAuthToken],
  handler: async (req, res) => {
    try {
      const {
        participants = [],
        name,
        description = '',
        categories = [],
      } = req.body
      const { chats, users } = getCollections()

      if (!name && participants.length === 0) {
        return res
          .status(400)
          .json({
            success: false,
            error: 'Chat must have a name or participants',
          })
      }

      // Current user (from token)
      const userId = req.user.uid
      const allParticipants = [...new Set([userId, ...participants])]

      // Detect if it's a direct chat
      let existingDirectChat = null
      if (allParticipants.length === 2 && !name) {
        existingDirectChat = await chats.findOne({
          isGroup: false,
          participants: { $all: allParticipants, $size: 2 },
        })
      }

      if (existingDirectChat) {
        return res.json({ success: true, chat: existingDirectChat })
      }

      // Prepare chat doc
      const newChat = {
        name: name || null,
        description,
        categories,
        participants: allParticipants.map((id) => new ObjectId(id)),
        isGroup: !!name, // if there's a name → group chat
        createdBy: new ObjectId(userId),
        createdAt: new Date(),
        updatedAt: new Date(),
        lastMessage: null,
      }

      const result = await chats.insertOne(newChat)

      const chat = { ...newChat, _id: result.insertedId }

      res.json({ success: true, chat })
    } catch (err) {
      console.error('❌ Error creating chat:', err)
      res.status(500).json({ success: false, error: 'Failed to create chat' })
    }
  },
}

module.exports = { createChatRoute }
