// backend/routes/messageStatus.js - FIXED VERSION

const { getCollections } = require('../db')
const { verifyAuthToken } = require('../middleware/verifyAuthToken')
const { ObjectId } = require('mongodb')

const markMessagesAsDeliveredRoute = {
  path: '/mark-messages-delivered/:chatId',
  method: 'post',
  middleware: [verifyAuthToken],
  handler: async (req, res) => {
    const { chatId } = req.params
    const { messageIds } = req.body
    const { messages, chats } = getCollections()
    const userId = req.user.uid

    console.log('📬 Mark delivered request:', {
      chatId,
      messageIds,
      userId,
    })

    try {
      // Verify user is part of the chat
      const chat = await chats.findOne({
        _id: new ObjectId(chatId),
        participants: userId,
      })

      if (!chat) {
        return res
          .status(403)
          .json({ success: false, error: 'Access denied to this chat' })
      }

      // Convert string IDs to ObjectIds
      const objectIds = messageIds
        .map((id) => {
          try {
            return new ObjectId(id)
          } catch (e) {
            console.error('Invalid message ID:', id)
            return null
          }
        })
        .filter(Boolean)

      // Update messages to delivered status
      const result = await messages.updateMany(
        {
          chatId: new ObjectId(chatId),
          _id: { $in: objectIds },
          senderId: { $ne: userId },
          status: { $in: ['sent', null] },
        },
        {
          $set: {
            status: 'delivered',
            deliveredAt: new Date(),
          },
          $addToSet: { deliveredBy: userId },
        }
      )

      console.log('📬 Updated count:', result.modifiedCount)

      // Get updated messages
      const updatedMessages = await messages
        .find({
          _id: { $in: objectIds },
        })
        .toArray()

      console.log('📬 Found messages:', updatedMessages.length)

      // Get signalingServer properly
      let signalingServerModule
      try {
        signalingServerModule = require('../signalingServer')
      } catch (err) {
        console.error('❌ Could not load signalingServer module:', err)
      }

      // ✅ FIX: Send individual notifications for EACH message to its sender
      if (signalingServerModule?.notificationClients) {
        const { notificationClients } = signalingServerModule

        updatedMessages.forEach((msg) => {
          const senderId = msg.senderId
          const messageId = msg._id.toString()

          console.log(
            '📬 Attempting to notify sender:',
            senderId,
            'for message:',
            messageId
          )

          const client = notificationClients.get(senderId)
          if (client && client.ws.readyState === 1) {
            try {
              client.ws.send(
                JSON.stringify({
                  type: 'message-delivered', // ✅ Matches frontend handler
                  chatId,
                  messageId, // ✅ Single messageId, not array
                  deliveredBy: userId,
                  timestamp: new Date().toISOString(),
                })
              )
              console.log(
                '✅ Sent delivery notification to:',
                senderId,
                'for message:',
                messageId
              )
            } catch (err) {
              console.error('❌ Failed to send notification:', err)
            }
          } else {
            console.log(
              '⚠️ Client not connected:',
              senderId,
              'readyState:',
              client?.ws?.readyState
            )
          }
        })
      } else {
        console.error('❌ notificationClients not available')
      }

      res.json({ success: true, modifiedCount: result.modifiedCount })
    } catch (err) {
      console.error('❌ Error marking messages as delivered:', err)
      res
        .status(500)
        .json({ success: false, error: 'Failed to mark messages as delivered' })
    }
  },
}

const markMessagesAsReadRoute = {
  path: '/mark-messages-read/:chatId',
  method: 'post',
  middleware: [verifyAuthToken],
  handler: async (req, res) => {
    const { chatId } = req.params
    const { messageIds } = req.body
    const { messages, chats } = getCollections()
    const userId = req.user.uid

    console.log('👁️ Mark read request:', {
      chatId,
      messageIds,
      userId,
    })

    try {
      // Verify user is part of the chat
      const chat = await chats.findOne({
        _id: new ObjectId(chatId),
        participants: userId,
      })

      if (!chat) {
        return res
          .status(403)
          .json({ success: false, error: 'Access denied to this chat' })
      }

      // Build query
      const query = {
        chatId: new ObjectId(chatId),
        senderId: { $ne: userId },
        readBy: { $ne: userId },
      }

      // If specific message IDs provided, add to query
      if (messageIds && Array.isArray(messageIds) && messageIds.length > 0) {
        const objectIds = messageIds
          .map((id) => {
            try {
              return new ObjectId(id)
            } catch (e) {
              console.error('Invalid message ID:', id)
              return null
            }
          })
          .filter(Boolean)

        query._id = { $in: objectIds }
      }

      // Update messages to read status
      const result = await messages.updateMany(query, {
        $set: {
          status: 'read',
          readAt: new Date(),
        },
        $addToSet: { readBy: userId },
      })

      console.log('👁️ Updated count:', result.modifiedCount)

      // Get updated messages
      const updatedMessages = await messages
        .find({
          chatId: new ObjectId(chatId),
          readBy: userId,
          senderId: { $ne: userId },
        })
        .toArray()

      console.log('👁️ Found messages:', updatedMessages.length)

      // Get signalingServer properly
      let signalingServerModule
      try {
        signalingServerModule = require('../signalingServer')
      } catch (err) {
        console.error('❌ Could not load signalingServer module:', err)
      }

      // ✅ FIX: Group messages by sender and send one notification per sender
      if (signalingServerModule?.notificationClients) {
        const { notificationClients } = signalingServerModule

        // Group messages by sender
        const messageBySender = {}
        updatedMessages.forEach((msg) => {
          if (!messageBySender[msg.senderId]) {
            messageBySender[msg.senderId] = []
          }
          messageBySender[msg.senderId].push(msg._id.toString())
        })

        console.log('👁️ Notifying senders:', Object.keys(messageBySender))

        // Send notifications to each sender
        Object.entries(messageBySender).forEach(([senderId, msgIds]) => {
          const client = notificationClients.get(senderId)
          if (client && client.ws.readyState === 1) {
            try {
              client.ws.send(
                JSON.stringify({
                  type: 'message-read', // ✅ Matches frontend handler
                  chatId,
                  messageIds: msgIds, // ✅ Array of message IDs
                  readBy: userId,
                  timestamp: new Date().toISOString(),
                })
              )
              console.log(
                '✅ Sent read notification to:',
                senderId,
                msgIds.length,
                'messages'
              )
            } catch (err) {
              console.error('❌ Failed to send notification:', err)
            }
          } else {
            console.log(
              '⚠️ Client not connected:',
              senderId,
              'readyState:',
              client?.ws?.readyState
            )
          }
        })
      } else {
        console.error('❌ notificationClients not available')
      }

      res.json({
        success: true,
        modifiedCount: result.modifiedCount,
        messageIds: updatedMessages.map((msg) => msg._id.toString()),
      })
    } catch (err) {
      console.error('❌ Error marking messages as read:', err)
      res
        .status(500)
        .json({ success: false, error: 'Failed to mark messages as read' })
    }
  },
}

module.exports = { markMessagesAsDeliveredRoute, markMessagesAsReadRoute }
