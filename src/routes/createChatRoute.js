// ============================================================================
// CREATE CHAT ROUTE (create-chat.js) - WITH REAL-TIME BROADCASTING
// ============================================================================
const { getCollections } = require('../db')
const { updateLastSeen } = require('../middleware/updateLastSeen')
const { verifyAuthToken } = require('../middleware/verifyAuthToken')
const { ObjectId } = require('mongodb')

const createChatRoute = {
  path: '/create-chat',
  method: 'post',
  middleware: [verifyAuthToken, updateLastSeen],
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

      // ✅ Determine if this is a group chat
      // A group chat is ONLY when there are MORE than 2 participants
      const isGroup = finalParticipants.length > 2

      // ✅ Handle 1-on-1 chat duplicate prevention
      if (finalParticipants.length === 2) {
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
          console.log('💬 Existing 1-on-1 chat found:', existingChat._id)
          return res.json({
            success: true,
            chat: existingChat,
            message: 'Chat already exists',
            isExisting: true, // ✅ Flag to indicate this is not a new chat
          })
        }
      }

      // ✅ Fetch participant details for real-time broadcast
      const participantDetails = {}
      for (const participantId of finalParticipants) {
        const participantUser = await users.findOne({
          firebaseUid: participantId,
        })
        if (participantUser) {
          participantDetails[participantId] = {
            _id: participantUser._id,
            firebaseUid: participantUser.firebaseUid,
            name: participantUser.name,
            displayName: participantUser.displayName,
            photoURL: participantUser.photoURL,
            online: participantUser.online || false,
          }
        }
      }

      // ✅ Create new chat
      const newChat = {
        participants: finalParticipants,
        participantDetails, // ✅ Include participant info for immediate display
        name: name || null, // Name is optional for 1-on-1, required for groups
        createdBy: currentUserId,
        createdAt: new Date(),
        lastActivity: new Date(),
        lastMessage: null,
        isGroup, // Only true if more than 2 participants
        unreadCount: 0,
      }

      const result = await chats.insertOne(newChat)
      const createdChat = { ...newChat, _id: result.insertedId }

      console.log('✅ Chat created:', {
        id: createdChat._id,
        isGroup: createdChat.isGroup,
        participantCount: finalParticipants.length,
      })

      // ✅ REAL-TIME: Broadcast new chat to all participants via WebSocket
      const wsClients = req.app.get('wsClients')
      if (wsClients) {
        console.log(
          '📡 Broadcasting new chat to participants:',
          finalParticipants
        )

        finalParticipants.forEach((participantId) => {
          // Don't send to the creator - they'll get it in the response
          if (participantId === currentUserId) return

          const client = wsClients.get(participantId)
          if (client && client.ws.readyState === 1) {
            try {
              client.ws.send(
                JSON.stringify({
                  type: 'new-chat',
                  chat: createdChat,
                  createdBy: currentUserId,
                  timestamp: new Date().toISOString(),
                })
              )
              console.log(`✅ Sent new-chat notification to ${participantId}`)
            } catch (err) {
              console.error(
                `❌ Failed to send new-chat to ${participantId}:`,
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
        chat: createdChat,
        message: 'Chat created successfully',
        isExisting: false,
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
