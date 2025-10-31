// backend/routes/markMessagesStatus.js
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

    try {
      const chat = await chats.findOne({
        _id: new ObjectId(chatId),
        participants: userId,
      })

      if (!chat) {
        return res
          .status(403)
          .json({ success: false, error: 'Access denied to this chat' })
      }

      const result = await messages.updateMany(
        {
          chatId: new ObjectId(chatId),
          _id: { $in: messageIds.map((id) => new ObjectId(id)) },
          status: 'sent',
        },
        { $set: { status: 'delivered' } }
      )

      // Notify sender via WebSocket
      const wsClients = require('../signalingServer').wsClients
      const senderIds = new Set(
        (
          await messages
            .find({ _id: { $in: messageIds.map((id) => new ObjectId(id)) } })
            .toArray()
        ).map((msg) => msg.senderId)
      )

      senderIds.forEach((senderId) => {
        if (senderId !== userId) {
          const client = wsClients.get(senderId)
          if (client && client.readyState === WebSocket.OPEN) {
            client.send(
              JSON.stringify({
                type: 'messages_delivered',
                chatId,
                messageIds,
              })
            )
          }
        }
      })

      res.json({ success: true, modifiedCount: result.modifiedCount })
    } catch (err) {
      console.error('Error marking messages as delivered:', err)
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
    const { messages, chats } = getCollections()
    const userId = req.user.uid

    try {
      const chat = await chats.findOne({
        _id: new ObjectId(chatId),
        participants: userId,
      })

      if (!chat) {
        return res
          .status(403)
          .json({ success: false, error: 'Access denied to this chat' })
      }

      const result = await messages.updateMany(
        {
          chatId: new ObjectId(chatId),
          senderId: { $ne: userId },
          readBy: { $ne: userId },
        },
        {
          $set: { status: 'read' },
          $addToSet: { readBy: userId },
        }
      )

      const updatedMessages = await messages
        .find({
          chatId: new ObjectId(chatId),
          readBy: userId,
        })
        .toArray()

      const wsClients = require('../signalingServer').wsClients
      chat.participants.forEach((participantId) => {
        if (participantId !== userId) {
          const client = wsClients.get(participantId)
          if (client && client.readyState === WebSocket.OPEN) {
            client.send(
              JSON.stringify({
                type: 'messages_read',
                chatId,
                messageIds: updatedMessages.map((msg) => msg._id.toString()),
                userId,
              })
            )
          }
        }
      })

      res.json({ success: true, modifiedCount: result.modifiedCount })
    } catch (err) {
      console.error('Error marking messages as read:', err)
      res
        .status(500)
        .json({ success: false, error: 'Failed to mark messages as read' })
    }
  },
}

module.exports = { markMessagesAsDeliveredRoute, markMessagesAsReadRoute }
