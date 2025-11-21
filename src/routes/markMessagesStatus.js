// backend/routes/messageStatus.js - CORRECTED VERSION
// ✅ NO require of signalingServer - use req.app.wsClients instead!

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
      count: messageIds?.length,
      userId,
    })

    try {
      // Verify user is part of the chat
      const chat = await chats.findOne({
        _id: new ObjectId(chatId),
        participants: userId,
      })

      if (!chat) {
        return res.status(403).json({
          success: false,
          error: 'Access denied',
        })
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

      if (objectIds.length === 0) {
        return res.json({ success: true, modifiedCount: 0 })
      }

      // Update messages
      const result = await messages.updateMany(
        {
          chatId: new ObjectId(chatId),
          _id: { $in: objectIds },
          senderId: { $ne: userId },
          deliveredBy: { $ne: userId },
        },
        {
          $set: {
            status: 'delivered',
            deliveredAt: new Date(),
          },
          $addToSet: { deliveredBy: userId },
        }
      )

      console.log('📬 Updated:', result.modifiedCount, 'messages')

      // Get updated messages
      const updatedMessages = await messages
        .find({ _id: { $in: objectIds } })
        .toArray()

      console.log(
        '📬 Found',
        updatedMessages.length,
        'messages to notify about'
      )

      // ✅ CRITICAL FIX: Use req.app.wsClients instead of require
      const wsClients = req.app.wsClients || global.wsClients

      if (!wsClients) {
        console.error('❌ WebSocket clients not available!')
      } else {
        console.log('✅ WebSocket clients available, size:', wsClients.size)

        // Send WebSocket notifications to each message sender
        updatedMessages.forEach((msg) => {
          const senderId = msg.senderId
          console.log(`📬 Looking for sender: ${senderId}`)

          const client = wsClients.get(senderId)

          if (!client) {
            console.warn(`⚠️ Sender ${senderId} not connected via WebSocket`)
            return
          }

          if (client.ws.readyState !== 1) {
            console.warn(
              `⚠️ Sender ${senderId} socket not ready (state: ${client.ws.readyState})`
            )
            return
          }

          try {
            const notification = {
              type: 'message-delivered',
              chatId,
              messageId: msg._id.toString(),
              deliveredBy: userId,
              timestamp: new Date().toISOString(),
            }

            console.log('📤 Sending notification:', notification)
            client.ws.send(JSON.stringify(notification))
            console.log(
              '✅ Notified sender:',
              senderId,
              'about message',
              msg._id
            )
          } catch (err) {
            console.error(`❌ Failed to notify ${senderId}:`, err.message)
          }
        })
      }

      res.json({
        success: true,
        modifiedCount: result.modifiedCount,
      })
    } catch (err) {
      console.error('❌ Error marking delivered:', err)
      res.status(500).json({
        success: false,
        error: 'Failed to mark messages as delivered',
      })
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
      count: messageIds?.length,
      userId,
      messageIds,
    })

    try {
      // Verify user is part of the chat
      const chat = await chats.findOne({
        _id: new ObjectId(chatId),
        participants: userId,
      })

      if (!chat) {
        return res.status(403).json({
          success: false,
          error: 'Access denied',
        })
      }

      // Build query
      const query = {
        chatId: new ObjectId(chatId),
        senderId: { $ne: userId }, // ✅ NOT sent by current user
        readBy: { $ne: userId }, // ✅ NOT already read by current user
      }

      // ✅ CRITICAL FIX: Declare objectIds BEFORE using it
      let objectIds = []

      // Add specific message IDs if provided
      if (messageIds && Array.isArray(messageIds) && messageIds.length > 0) {
        objectIds = messageIds
          .map((id) => {
            try {
              return new ObjectId(id)
            } catch (e) {
              console.error('Invalid ObjectId:', id)
              return null
            }
          })
          .filter(Boolean)

        if (objectIds.length > 0) {
          query._id = { $in: objectIds }
        }
      }

      console.log('👁️ Query:', JSON.stringify(query))
      console.log('👁️ ObjectIds count:', objectIds.length)

      // Update messages
      const result = await messages.updateMany(query, {
        $set: {
          status: 'read',
          readAt: new Date(),
        },
        $addToSet: { readBy: userId },
      })

      console.log('👁️ Updated:', result.modifiedCount, 'messages')

      // ✅ Get updated messages to notify senders
      const updatedMessages = await messages
        .find({
          _id: { $in: objectIds },
          senderId: { $ne: userId },
        })
        .toArray()

      console.log(
        '👁️ Found',
        updatedMessages.length,
        'messages to notify about'
      )

      // ✅ Use req.app.wsClients instead of require
      const wsClients = req.app.wsClients || global.wsClients

      if (!wsClients) {
        console.error('❌ WebSocket clients not available!')
      } else {
        console.log('✅ WebSocket clients available, size:', wsClients.size)

        // Group messages by sender
        const messagesBySender = {}
        updatedMessages.forEach((msg) => {
          const senderId = msg.senderId
          if (!messagesBySender[senderId]) {
            messagesBySender[senderId] = []
          }
          messagesBySender[senderId].push(msg._id.toString())
        })

        console.log(
          '👁️ Notifying',
          Object.keys(messagesBySender).length,
          'senders'
        )

        // Notify each sender
        Object.entries(messagesBySender).forEach(([senderId, msgIds]) => {
          console.log(`👁️ Looking for sender: ${senderId}`)

          const client = wsClients.get(senderId)

          if (!client) {
            console.warn(`⚠️ Sender ${senderId} not connected via WebSocket`)
            return
          }

          if (client.ws.readyState !== 1) {
            console.warn(
              `⚠️ Sender ${senderId} socket not ready (state: ${client.ws.readyState})`
            )
            return
          }

          try {
            const notification = {
              type: 'message-read',
              chatId,
              messageIds: msgIds, // ✅ Array of message IDs
              readBy: userId,
              timestamp: new Date().toISOString(),
            }

            console.log('📤 Sending notification:', notification)
            client.ws.send(JSON.stringify(notification))
            console.log(
              '✅ Notified sender:',
              senderId,
              'about',
              msgIds.length,
              'messages'
            )
          } catch (err) {
            console.error(`❌ Failed to notify ${senderId}:`, err.message)
          }
        })
      }

      res.json({
        success: true,
        modifiedCount: result.modifiedCount,
        messageIds: updatedMessages.map((msg) => msg._id.toString()),
      })
    } catch (err) {
      console.error('❌ Error marking read:', err)
      res.status(500).json({
        success: false,
        error: 'Failed to mark messages as read',
      })
    }
  },
}

module.exports = {
  markMessagesAsDeliveredRoute,
  markMessagesAsReadRoute,
}
