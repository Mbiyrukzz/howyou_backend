const { WebSocketServer } = require('ws')
const url = require('url')

function setupSignalingServer(server) {
  const wss = new WebSocketServer({ noServer: true })
  const clients = new Map() // Map<userId, ws>
  const callRooms = new Map() // Map<chatId, Set<userId>>

  // Handle WebSocket upgrade for BOTH /notifications AND / (root)
  server.on('upgrade', (request, socket, head) => {
    const pathname = url.parse(request.url).pathname

    console.log(`🔌 WebSocket upgrade request: ${pathname}`)

    // Accept connections on /, /notifications, or /signaling
    if (
      pathname === '/' ||
      pathname === '/notifications' ||
      pathname === '/signaling'
    ) {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request)
      })
    } else {
      console.warn(`❌ WebSocket rejected for path: ${pathname}`)
      socket.destroy()
    }
  })

  // Handle new connections
  wss.on('connection', (ws, request) => {
    const params = new URLSearchParams(url.parse(request.url).query)
    const userId = params.get('userId')
    const chatId = params.get('chatId')
    const pathname = url.parse(request.url).pathname

    if (!userId) {
      console.error('❌ WebSocket connection rejected: Missing userId')
      ws.close(1008, 'Missing userId parameter')
      return
    }

    // Store connection
    clients.set(userId, ws)
    console.log(`✅ User connected: ${userId} on ${pathname}`)

    // If chatId provided, add to call room
    if (chatId) {
      if (!callRooms.has(chatId)) {
        callRooms.set(chatId, new Set())
      }
      callRooms.get(chatId).add(userId)
      console.log(`📞 User ${userId} joined call room: ${chatId}`)

      // Notify other users in the room
      broadcastToRoom(chatId, userId, {
        type: 'user-joined',
        userId,
        chatId,
      })
    }

    // Send connection confirmation
    ws.send(
      JSON.stringify({
        type: 'connected',
        userId,
        timestamp: new Date().toISOString(),
      })
    )

    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message)
        handleSignalMessage(userId, data)
      } catch (err) {
        console.error('❌ Invalid message format:', err)
        ws.send(
          JSON.stringify({
            type: 'error',
            message: 'Invalid message format',
          })
        )
      }
    })

    ws.on('close', () => {
      clients.delete(userId)

      // Remove from all call rooms
      callRooms.forEach((users, roomChatId) => {
        if (users.has(userId)) {
          users.delete(userId)
          broadcastToRoom(roomChatId, userId, {
            type: 'user-left',
            userId,
            chatId: roomChatId,
          })

          // Clean up empty rooms
          if (users.size === 0) {
            callRooms.delete(roomChatId)
          }
        }
      })

      console.log(`❌ User disconnected: ${userId}`)
    })

    ws.on('error', (error) => {
      console.error(`❌ WebSocket error for user ${userId}:`, error.message)
    })
  })

  // Handle signaling messages
  function handleSignalMessage(senderId, data) {
    console.log(`📨 Message from ${senderId}:`, data.type)

    switch (data.type) {
      case 'join-call':
        handleJoinCall(senderId, data)
        break

      case 'webrtc-offer':
        forwardToUser(data.to, {
          type: 'webrtc-offer',
          offer: data.offer,
          from: senderId,
          chatId: data.chatId,
        })
        break

      case 'webrtc-answer':
        forwardToUser(data.to, {
          type: 'webrtc-answer',
          answer: data.answer,
          from: senderId,
          chatId: data.chatId,
        })
        break

      case 'webrtc-ice-candidate':
        forwardToUser(data.to, {
          type: 'webrtc-ice-candidate',
          candidate: data.candidate,
          from: senderId,
          chatId: data.chatId,
        })
        break

      case 'screen-sharing': // New case for screen sharing
        forwardToUser(data.to, {
          type: 'screen-sharing',
          enabled: data.enabled,
          from: senderId,
          chatId: data.chatId,
        })
        break

      case 'end-call':
        handleEndCall(senderId, data)
        break

      case 'ping':
        // Respond to ping to keep connection alive
        const socket = clients.get(senderId)
        if (socket && socket.readyState === socket.OPEN) {
          socket.send(JSON.stringify({ type: 'pong' }))
        }
        break

      default:
        console.warn('⚠️ Unknown message type:', data.type)
    }
  }

  function handleJoinCall(userId, data) {
    const { chatId } = data

    if (!callRooms.has(chatId)) {
      callRooms.set(chatId, new Set())
    }

    callRooms.get(chatId).add(userId)
    console.log(`📞 User ${userId} joined call room: ${chatId}`)

    // Notify existing users
    broadcastToRoom(chatId, userId, {
      type: 'user-joined',
      userId,
      chatId,
    })
  }

  function handleEndCall(userId, data) {
    const { chatId } = data

    // Notify all users in the room
    broadcastToRoom(chatId, null, {
      type: 'call-ended',
      userId,
      chatId,
    })

    // Remove user from room
    if (callRooms.has(chatId)) {
      callRooms.get(chatId).delete(userId)

      if (callRooms.get(chatId).size === 0) {
        callRooms.delete(chatId)
      }
    }

    console.log(`🔴 User ${userId} ended call in room: ${chatId}`)
  }

  function forwardToUser(userId, message) {
    const socket = clients.get(userId)

    if (socket && socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify(message))
      console.log(`✉️ Forwarded message to ${userId}:`, message.type)
    } else {
      console.warn(`⚠️ User ${userId} not connected or socket not ready`)
    }
  }

  function broadcastToRoom(chatId, excludeUserId, message) {
    const room = callRooms.get(chatId)

    if (!room) return

    room.forEach((userId) => {
      if (userId !== excludeUserId) {
        forwardToUser(userId, message)
      }
    })
  }

  // Keep-alive ping every 30 seconds
  setInterval(() => {
    clients.forEach((ws, userId) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: 'ping' }))
      }
    })
  }, 30000)

  console.log('✅ WebRTC signaling server initialized')
  console.log('📡 Accepting connections on: /, /notifications, /signaling')

  // Return clients Map so it can be used by API routes
  return clients
}

module.exports = { setupSignalingServer }
