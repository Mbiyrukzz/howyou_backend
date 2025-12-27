// callRoutes.js - Updated for LiveKit
const { getCollections } = require('../db')
const { verifyAuthToken } = require('../middleware/verifyAuthToken')
const { ObjectId } = require('mongodb')
const {
  sendCallNotification,
  sendCallEndedNotification,
  sendMissedCallNotification,
} = require('../utils/pushNotifications')
const {
  generateCallTokens,
  validateConnection,
  generateToken,
} = require('../services/livekitService')

let notificationClients = null

function setWebSocketClients(clients) {
  notificationClients =
    clients.notificationClients || global.notificationClients
  console.log('✅ Call routes initialized with WebSocket clients')
}

function sendToUser(userId, message) {
  if (!notificationClients) {
    console.warn('⚠️ No notification clients available')
    return false
  }

  const client = notificationClients.get(userId)
  if (!client || client.ws.readyState !== 1) {
    console.warn(`⚠️ User ${userId} not connected`)
    return false
  }

  try {
    client.ws.send(JSON.stringify(message))
    console.log(`📨 Sent to ${userId}: ${message.type}`)
    return true
  } catch (err) {
    console.error(`❌ Failed to send to ${userId}:`, err.message)
    return false
  }
}

// Initiate a call with LiveKit
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
          error: 'chatId, callType, and recipientId are required',
        })
      }

      if (!['voice', 'video'].includes(callType)) {
        return res.status(400).json({
          success: false,
          error: 'callType must be "voice" or "video"',
        })
      }

      if (!ObjectId.isValid(chatId)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid chatId format',
        })
      }

      // Validate LiveKit connection
      if (!validateConnection()) {
        return res.status(500).json({
          success: false,
          error: 'LiveKit server not configured',
        })
      }

      const { calls, chats, users } = getCollections()

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
          error: 'Recipient not in chat',
        })
      }

      // Get user info
      const caller = await users.findOne({ firebaseUid: req.user.uid })
      const recipient = await users.findOne({ firebaseUid: recipientId })

      const callerName = caller?.name || req.user.displayName || 'Unknown'
      const recipientName = recipient?.name || 'Unknown'

      const tokenData = await generateCallTokens(
        chatId,
        { uid: req.user.uid, name: callerName },
        { uid: recipientId, name: recipientName }
      )

      // Create call record
      const newCall = {
        chatId: new ObjectId(chatId),
        callerId: req.user.uid,
        recipientId: recipientId,
        callType: callType,
        status: 'initiated',
        roomName: tokenData.roomName,
        startTime: new Date(),
        endTime: null,
        duration: null,
        createdAt: new Date(),
      }

      const result = await calls.insertOne(newCall)
      const callId = result.insertedId.toString()

      console.log('✅ Call record created:', callId)

      const callData = {
        callId,
        chatId: chatId,
        caller: req.user.uid,
        callerName,
        callType,
        roomName: tokenData.roomName,
        livekitUrl: tokenData.livekitUrl,
        recipientToken: tokenData.recipientToken, // Token for recipient to join
        timestamp: new Date().toISOString(),
      }

      // Send WebSocket notification
      const notificationSent = sendToUser(recipientId, {
        type: 'incoming_call',
        ...callData,
      })

      // Send push notification
      const pushSent = await sendCallNotification(
        recipientId,
        callerName,
        callType,
        callData
      )

      console.log('📨 Notifications sent:', {
        websocket: notificationSent,
        push: pushSent,
      })

      console.log('Generated tokens:', {
        roomName: tokenData.roomName,
        url: tokenData.livekitUrl,
        callerToken: tokenData.callerToken.substring(0, 20) + '...',
        recipientToken: tokenData.recipientToken.substring(0, 20) + '...',
      })

      // Return caller token
      res.json({
        success: true,
        call: { ...newCall, _id: result.insertedId },
        callerToken: tokenData.callerToken,
        roomName: tokenData.roomName,
        livekitUrl: tokenData.livekitUrl,
        message: `${callType} call initiated`,
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

// Answer call - return LiveKit token
const answerCallRoute = {
  path: '/answer-call/:callId',
  method: 'post',
  middleware: [verifyAuthToken],
  handler: async (req, res) => {
    try {
      const { callId } = req.params
      const { accepted } = req.body

      console.log('📱 Answer call:', { callId, accepted, userId: req.user.uid })

      if (!ObjectId.isValid(callId)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid callId',
        })
      }

      const { calls, users } = getCollections()

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

      const recipient = await users.findOne({ firebaseUid: req.user.uid })
      const caller = await users.findOne({ firebaseUid: call.callerId })

      const recipientName = recipient?.name || req.user.displayName || 'Unknown'
      const callerName = caller?.name || 'Unknown'

      const updateData = {
        status: accepted ? 'accepted' : 'declined',
        answeredAt: new Date(),
      }

      if (accepted) {
        updateData.actualStartTime = new Date()

        const recipientToken = await generateToken(
          call.roomName,
          req.user.uid,
          recipientName,
          { metadata: JSON.stringify({ role: 'recipient' }) }
        )

        // Notify caller
        sendToUser(call.callerId, {
          type: 'call_accepted',
          callId: callId,
          from: req.user.uid,
          recipientName: recipientName,
          timestamp: new Date().toISOString(),
        })

        await calls.updateOne(
          { _id: new ObjectId(callId) },
          { $set: updateData }
        )

        res.json({
          success: true,
          call: { ...call, ...updateData },
          recipientToken,
          roomName: call.roomName,
          livekitUrl: process.env.LIVEKIT_URL || 'ws://localhost:7880',
          message: 'Call accepted',
        })
      } else {
        // Send rejection
        sendToUser(call.callerId, {
          type: 'call_rejected',
          callId: callId,
          recipientName: recipientName,
          timestamp: new Date().toISOString(),
        })

        await sendMissedCallNotification(
          call.callerId,
          recipientName,
          call.callType
        )
        await calls.updateOne(
          { _id: new ObjectId(callId) },
          { $set: updateData }
        )

        res.json({
          success: true,
          call: { ...call, ...updateData },
          message: 'Call declined',
        })
      }
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

// End call
const endCallRoute = {
  path: '/end-call/:callId',
  method: 'post',
  middleware: [verifyAuthToken],
  handler: async (req, res) => {
    try {
      const { callId } = req.params

      if (!ObjectId.isValid(callId)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid callId',
        })
      }

      const { calls, users } = getCollections()

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

      const otherUserId =
        call.callerId === req.user.uid ? call.recipientId : call.callerId

      sendToUser(otherUserId, {
        type: 'call_ended',
        callId: callId,
        duration: duration,
        timestamp: new Date().toISOString(),
      })

      const currentUser = await users.findOne({ firebaseUid: req.user.uid })
      const currentUserName =
        currentUser?.name || req.user.displayName || 'Unknown'

      await sendCallEndedNotification(otherUserId, currentUserName, duration)

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

// Cancel call (for timeouts/missed calls)
const cancelCallRoute = {
  path: '/cancel-call/:callId',
  method: 'post',
  middleware: [verifyAuthToken],
  handler: async (req, res) => {
    try {
      const { callId } = req.params
      const { reason } = req.body

      if (!ObjectId.isValid(callId)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid callId',
        })
      }

      const { calls, users } = getCollections()

      const call = await calls.findOne({
        _id: new ObjectId(callId),
        $or: [
          { callerId: req.user.uid, status: 'initiated' },
          { recipientId: req.user.uid, status: 'initiated' },
        ],
      })

      if (!call) {
        return res.status(404).json({
          success: false,
          error: 'Call not found',
        })
      }

      const isRecipientCancelling = call.recipientId === req.user.uid
      let finalStatus =
        reason === 'timeout'
          ? 'missed'
          : isRecipientCancelling
          ? 'declined'
          : 'cancelled'

      await calls.updateOne(
        { _id: new ObjectId(callId) },
        {
          $set: {
            status: finalStatus,
            endTime: new Date(),
            duration: 0,
          },
        }
      )

      const currentUser = await users.findOne({ firebaseUid: req.user.uid })
      const currentUserName =
        currentUser?.name || req.user.displayName || 'Unknown'

      const otherUserId =
        call.callerId === req.user.uid ? call.recipientId : call.callerId

      sendToUser(otherUserId, {
        type: 'call_ended',
        callId: callId,
        reason: finalStatus,
        callerName: currentUserName,
        timestamp: new Date().toISOString(),
      })

      if (finalStatus === 'missed' || finalStatus === 'declined') {
        await sendMissedCallNotification(
          otherUserId,
          currentUserName,
          call.callType
        )
      }

      console.log(`✅ Call ${finalStatus}:`, callId)

      res.json({
        success: true,
        message: `Call ${finalStatus}`,
      })
    } catch (err) {
      console.error('❌ Error cancelling call:', err)
      res.status(500).json({
        success: false,
        error: 'Failed to cancel call',
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
          error: 'Invalid chatId',
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
          error: 'Access denied',
        })
      }

      const callHistory = await calls
        .find({ chatId: new ObjectId(chatId) })
        .sort({ createdAt: -1 })
        .toArray()

      const transformedCalls = callHistory.map((call) => {
        const isIncoming = call.recipientId === req.user.uid
        const direction = isIncoming ? 'incoming' : 'outgoing'

        let status = call.status
        if (call.status === 'missed') status = 'missed'
        else if (call.status === 'cancelled')
          status = isIncoming ? 'missed' : 'cancelled'
        else if (call.status === 'declined') status = 'rejected'
        else if (call.status === 'accepted' || call.status === 'ended')
          status = 'completed'

        return {
          _id: call._id,
          chatId: call.chatId,
          callerId: call.callerId,
          recipientId: call.recipientId,
          callType: call.callType,
          status,
          direction,
          duration: call.duration || 0,
          createdAt: call.createdAt,
          startTime: call.startTime,
          endTime: call.endTime,
        }
      })

      res.json({
        success: true,
        calls: transformedCalls,
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
  cancelCallRoute,
  getCallHistoryRoute,
  setWebSocketClients,
}
