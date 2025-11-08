const { getCollections } = require('../db')
const { verifyAuthToken } = require('../middleware/verifyAuthToken')
const { ObjectId } = require('mongodb')
const {
  sendCallNotification,
  sendCallEndedNotification,
  sendMissedCallNotification,
} = require('../utils/pushNotifications')

let wsClients = null
let signalingClients = null
let notificationClients = null

function setWebSocketClients(clients) {
  wsClients = clients
  // Also get specific endpoint clients from global
  signalingClients = global.signalingClients
  notificationClients = global.notificationClients
  console.log('✅ Call routes initialized with WebSocket clients:', {
    unified: !!wsClients,
    signaling: !!signalingClients,
    notifications: !!notificationClients,
  })
}

// Helper to send to specific endpoint
function sendToUserOnEndpoint(userId, message, endpoint = 'signaling') {
  let clientMap

  if (endpoint === 'signaling') {
    clientMap = signalingClients || global.signalingClients
  } else if (endpoint === 'notifications') {
    clientMap = notificationClients || global.notificationClients
  } else {
    clientMap = wsClients
  }

  if (!clientMap) {
    console.warn(`⚠️ No client map available for endpoint: ${endpoint}`)
    return false
  }

  const client = clientMap.get(userId)
  if (!client) {
    console.warn(`⚠️ No active WS client for ${userId} on /${endpoint}`)
    return false
  }

  const socket = client.ws
  if (!socket || typeof socket.send !== 'function') {
    console.warn(`⚠️ Invalid WebSocket object for ${userId}`)
    return false
  }

  if (socket.readyState === 1) {
    // WebSocket.OPEN
    socket.send(JSON.stringify(message))
    console.log(
      `📨 Sent WS message to ${userId} on /${endpoint}: ${message.type}`
    )
    return true
  }

  console.warn(
    `⚠️ WebSocket not open for ${userId} (state: ${socket.readyState})`
  )
  return false
}

// Legacy function for backward compatibility
function sendToUser(userId, message) {
  // Try signaling first, then notifications
  return (
    sendToUserOnEndpoint(userId, message, 'signaling') ||
    sendToUserOnEndpoint(userId, message, 'notifications')
  )
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
          error: 'Recipient is not a participant in this chat',
        })
      }

      // Get caller info
      const caller = await users.findOne({ firebaseUid: req.user.uid })
      const callerName =
        caller?.name || req.user.displayName || req.user.email || 'Unknown'

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

      const callData = {
        callId,
        chatId: chatId,
        caller: req.user.uid,
        callerName,
        callType,
        timestamp: new Date().toISOString(),
      }

      // ✅ Send to BOTH signaling and notifications endpoints
      // Signaling: For if user is already on call screen
      const signalingNotificationSent = sendToUserOnEndpoint(
        recipientId,
        {
          type: 'incoming_call',
          ...callData,
        },
        'signaling'
      )

      // Notifications: For in-app notification banner
      const notificationsSent = sendToUserOnEndpoint(
        recipientId,
        {
          type: 'incoming_call',
          ...callData,
        },
        'notifications'
      )

      console.log('📨 WebSocket notifications sent:', {
        signaling: signalingNotificationSent,
        notifications: notificationsSent,
      })

      // ALWAYS send push notification (works even if user is offline)
      const pushNotificationSent = await sendCallNotification(
        recipientId,
        callerName,
        callType,
        callData
      )

      if (pushNotificationSent) {
        console.log(`✅ Push notification sent to ${recipientId}`)
      } else {
        console.warn(`⚠️ Failed to send push notification to ${recipientId}`)
      }

      res.json({
        success: true,
        call: { ...newCall, _id: result.insertedId },
        message: `${callType} call initiated`,
        notificationSent: {
          signaling: signalingNotificationSent,
          notifications: notificationsSent,
          push: pushNotificationSent,
        },
      })
    } catch (err) {
      console.error('❌ Error initiating call:', err.stack)
      res.status(500).json({
        success: false,
        error: 'Failed to initiate call',
        details: err.message,
      })
    }
  },
}

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

      // Get recipient info for notification
      const recipient = await users.findOne({ firebaseUid: req.user.uid })
      const recipientName =
        recipient?.name || req.user.displayName || req.user.email || 'Unknown'

      const updateData = {
        status: accepted ? 'accepted' : 'declined',
        answeredAt: new Date(),
      }

      if (accepted) {
        updateData.actualStartTime = new Date()

        // ✅ CRITICAL: Send to SIGNALING endpoint for WebRTC coordination
        const acceptNotificationSent = sendToUserOnEndpoint(
          call.callerId,
          {
            type: 'call_accepted',
            callId: callId,
            recipientId: req.user.uid,
            recipientName: recipientName,
            chatId: call.chatId.toString(),
            timestamp: new Date().toISOString(),
          },
          'signaling'
        )

        console.log(
          `✅ Call accepted notification sent to /signaling: ${acceptNotificationSent}`
        )

        // Also send to notifications for UI updates
        sendToUserOnEndpoint(
          call.callerId,
          {
            type: 'call_accepted',
            callId: callId,
            recipientName: recipientName,
            timestamp: new Date().toISOString(),
          },
          'notifications'
        )
      } else {
        // ✅ Send rejection to both endpoints
        const rejectNotificationSent = sendToUserOnEndpoint(
          call.callerId,
          {
            type: 'call_rejected',
            callId: callId,
            recipientId: req.user.uid,
            recipientName: recipientName,
            timestamp: new Date().toISOString(),
          },
          'signaling'
        )

        sendToUserOnEndpoint(
          call.callerId,
          {
            type: 'call_rejected',
            callId: callId,
            recipientName: recipientName,
            timestamp: new Date().toISOString(),
          },
          'notifications'
        )

        console.log(
          `✅ Call rejected notification sent: ${rejectNotificationSent}`
        )

        // Send missed call notification
        await sendMissedCallNotification(
          call.callerId,
          recipientName,
          call.callType
        )
      }

      await calls.updateOne({ _id: new ObjectId(callId) }, { $set: updateData })

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

      // Notify the other party on both endpoints
      const otherUserId =
        call.callerId === req.user.uid ? call.recipientId : call.callerId

      sendToUserOnEndpoint(
        otherUserId,
        {
          type: 'call_ended',
          callId: callId,
          endedBy: req.user.uid,
          duration: duration,
          timestamp: new Date().toISOString(),
        },
        'signaling'
      )

      sendToUserOnEndpoint(
        otherUserId,
        {
          type: 'call_ended',
          callId: callId,
          duration: duration,
          timestamp: new Date().toISOString(),
        },
        'notifications'
      )

      // Send push notification for call ended
      const currentUser = await users.findOne({ firebaseUid: req.user.uid })
      const currentUserName =
        currentUser?.name || req.user.displayName || req.user.email || 'Unknown'

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

const cancelCallRoute = {
  path: '/cancel-call/:callId',
  method: 'post',
  middleware: [verifyAuthToken],
  handler: async (req, res) => {
    try {
      const { callId } = req.params
      const { reason } = req.body

      console.log('⏰ Cancel call request:', {
        callId,
        reason,
        userId: req.user.uid,
      })

      if (!ObjectId.isValid(callId)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid callId format',
        })
      }

      const { calls, users } = getCollections()

      const call = await calls.findOne({
        _id: new ObjectId(callId),
        callerId: req.user.uid,
        status: 'initiated',
      })

      if (!call) {
        return res.status(404).json({
          success: false,
          error: 'Call not found or already answered',
        })
      }

      const updateData = {
        status: reason === 'timeout' ? 'missed' : 'cancelled',
        endTime: new Date(),
        duration: 0,
      }

      await calls.updateOne({ _id: new ObjectId(callId) }, { $set: updateData })

      const caller = await users.findOne({ firebaseUid: req.user.uid })
      const callerName =
        caller?.name || req.user.displayName || req.user.email || 'Unknown'

      // Notify recipient on both endpoints
      sendToUserOnEndpoint(
        call.recipientId,
        {
          type: 'call-ended',
          callId: callId,
          reason: reason,
          callerName: callerName,
          timestamp: new Date().toISOString(),
        },
        'signaling'
      )

      sendToUserOnEndpoint(
        call.recipientId,
        {
          type: 'call-ended',
          callId: callId,
          reason: reason,
          timestamp: new Date().toISOString(),
        },
        'notifications'
      )

      // Send missed call notification
      if (reason === 'timeout') {
        await sendMissedCallNotification(
          call.recipientId,
          callerName,
          call.callType
        )
      }

      console.log(`✅ Call ${reason}:`, callId)

      res.json({
        success: true,
        call: { ...call, ...updateData },
        message: `Call ${reason}`,
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
  cancelCallRoute,
  getCallHistoryRoute,
  setWebSocketClients,
}
