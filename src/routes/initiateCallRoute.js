const { getCollections } = require('../db')
const { verifyAuthToken } = require('../middleware/verifyAuthToken')
const { ObjectId } = require('mongodb')

// Store WebSocket clients - this should be passed from the signaling server
// For now, we'll use a global reference (better to pass via dependency injection)
let wsClients = null

function setWebSocketClients(clients) {
  wsClients = clients
}

// Helper to send WebSocket message to a user
function sendToUser(userId, message) {
  if (wsClients && wsClients.has(userId)) {
    const socket = wsClients.get(userId)
    if (socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify(message))
      return true
    }
  }
  return false
}

// Initiate a call
const initiateCallRoute = {
  path: '/initiate-call',
  method: 'post',
  middleware: [verifyAuthToken],
  handler: async (req, res) => {
    try {
      const { chatId, callType, recipientId } = req.body

      console.log('📞 Initiate call request:', {
        chatId,
        callType,
        recipientId,
        callerId: req.user?.uid,
      })

      if (!chatId || !callType || !recipientId) {
        return res.status(400).json({
          success: false,
          error: 'chatId, callType (voice/video), and recipientId are required',
        })
      }

      if (!['voice', 'video'].includes(callType)) {
        return res.status(400).json({
          success: false,
          error: 'callType must be either "voice" or "video"',
        })
      }

      if (!ObjectId.isValid(chatId)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid chatId format',
        })
      }

      const { calls, chats } = getCollections()

      // Verify chat access
      const chat = await chats.findOne({
        _id: new ObjectId(chatId),
        participants: req.user.uid,
      })

      if (!chat) {
        return res.status(403).json({
          success: false,
          error: 'Access denied to this chat',
        })
      }

      if (!chat.participants.includes(recipientId)) {
        return res.status(400).json({
          success: false,
          error: 'Recipient is not a participant in this chat',
        })
      }

      // Create call record
      const newCall = {
        chatId: new ObjectId(chatId),
        callerId: req.user.uid,
        recipientId: recipientId,
        callType: callType,
        status: 'initiated',
        startTime: new Date(),
        endTime: null,
        duration: null,
        createdAt: new Date(),
      }

      const result = await calls.insertOne(newCall)
      const callId = result.insertedId.toString()

      console.log('✅ Call record created:', callId)

      // Send WebSocket notification to recipient
      const notificationSent = sendToUser(recipientId, {
        type: 'incoming_call',
        caller: req.user.uid,
        callerId: req.user.uid,
        callerName: req.user.displayName || req.user.email,
        callType: callType,
        chatId: chatId,
        callId: callId,
        timestamp: new Date().toISOString(),
      })

      if (notificationSent) {
        console.log(`✅ Call notification sent to ${recipientId}`)
      } else {
        console.warn(`⚠️ Recipient ${recipientId} is offline`)
      }

      res.json({
        success: true,
        call: { ...newCall, _id: result.insertedId },
        message: `${callType} call initiated`,
        notificationSent,
      })
    } catch (err) {
      console.error('❌ Error initiating call:', err)
      res.status(500).json({
        success: false,
        error: 'Failed to initiate call',
        details: err.message,
      })
    }
  },
}

// Answer a call
const answerCallRoute = {
  path: '/answer-call/:callId',
  method: 'post',
  middleware: [verifyAuthToken],
  handler: async (req, res) => {
    try {
      const { callId } = req.params
      const { accepted } = req.body

      console.log('📱 Answer call request:', {
        callId,
        accepted,
        userId: req.user.uid,
      })

      if (!ObjectId.isValid(callId)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid callId format',
        })
      }

      const { calls } = getCollections()

      const call = await calls.findOne({
        _id: new ObjectId(callId),
        recipientId: req.user.uid,
        status: 'initiated',
      })

      if (!call) {
        return res.status(404).json({
          success: false,
          error: 'Call not found or already answered',
        })
      }

      const updateData = {
        status: accepted ? 'accepted' : 'declined',
        answeredAt: new Date(),
      }

      if (accepted) {
        updateData.actualStartTime = new Date()
      }

      await calls.updateOne({ _id: new ObjectId(callId) }, { $set: updateData })

      // Notify caller about the response
      const notificationType = accepted ? 'call_accepted' : 'call_rejected'
      sendToUser(call.callerId, {
        type: notificationType,
        callId: callId,
        recipientId: req.user.uid,
        timestamp: new Date().toISOString(),
      })

      console.log(`✅ Call ${accepted ? 'accepted' : 'declined'}:`, callId)

      res.json({
        success: true,
        call: { ...call, ...updateData },
        message: `Call ${accepted ? 'accepted' : 'declined'}`,
      })
    } catch (err) {
      console.error('❌ Error answering call:', err)
      res.status(500).json({
        success: false,
        error: 'Failed to answer call',
        details: err.message,
      })
    }
  },
}

// End a call
const endCallRoute = {
  path: '/end-call/:callId',
  method: 'post',
  middleware: [verifyAuthToken],
  handler: async (req, res) => {
    try {
      const { callId } = req.params

      console.log('🔴 End call request:', { callId, userId: req.user.uid })

      if (!ObjectId.isValid(callId)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid callId format',
        })
      }

      const { calls } = getCollections()

      const call = await calls.findOne({
        _id: new ObjectId(callId),
        $or: [{ callerId: req.user.uid }, { recipientId: req.user.uid }],
        status: { $in: ['initiated', 'accepted'] },
      })

      if (!call) {
        return res.status(404).json({
          success: false,
          error: 'Call not found or already ended',
        })
      }

      const endTime = new Date()
      const startTime = call.actualStartTime || call.startTime
      const duration = Math.floor((endTime - startTime) / 1000)

      await calls.updateOne(
        { _id: new ObjectId(callId) },
        {
          $set: {
            status: 'ended',
            endTime: endTime,
            duration: duration,
          },
        }
      )

      // Notify the other party
      const otherUserId =
        call.callerId === req.user.uid ? call.recipientId : call.callerId

      sendToUser(otherUserId, {
        type: 'call_ended',
        callId: callId,
        endedBy: req.user.uid,
        duration: duration,
        timestamp: new Date().toISOString(),
      })

      console.log('✅ Call ended:', { callId, duration })

      res.json({
        success: true,
        call: {
          ...call,
          status: 'ended',
          endTime: endTime,
          duration: duration,
        },
        message: 'Call ended',
      })
    } catch (err) {
      console.error('❌ Error ending call:', err)
      res.status(500).json({
        success: false,
        error: 'Failed to end call',
        details: err.message,
      })
    }
  },
}

// Get call history
const getCallHistoryRoute = {
  path: '/call-history/:chatId',
  method: 'get',
  middleware: [verifyAuthToken],
  handler: async (req, res) => {
    try {
      const { chatId } = req.params

      if (!ObjectId.isValid(chatId)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid chatId format',
        })
      }

      const { calls, chats } = getCollections()

      const chat = await chats.findOne({
        _id: new ObjectId(chatId),
        participants: req.user.uid,
      })

      if (!chat) {
        return res.status(403).json({
          success: false,
          error: 'Access denied to this chat',
        })
      }

      const callHistory = await calls
        .find({ chatId: new ObjectId(chatId) })
        .sort({ createdAt: -1 })
        .toArray()

      console.log(`✅ Call history retrieved: ${callHistory.length} calls`)

      res.json({
        success: true,
        calls: callHistory,
      })
    } catch (err) {
      console.error('❌ Error getting call history:', err)
      res.status(500).json({
        success: false,
        error: 'Failed to get call history',
        details: err.message,
      })
    }
  },
}

module.exports = {
  initiateCallRoute,
  answerCallRoute,
  endCallRoute,
  getCallHistoryRoute,
  setWebSocketClients,
}
