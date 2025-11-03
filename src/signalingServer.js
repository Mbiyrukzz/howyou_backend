const { WebSocketServer } = require('ws')
const url = require('url')

function setupSignalingServer(server) {
  const wss = new WebSocketServer({ noServer: true })
  const clients = new Map() // Map<userId, {ws, metadata}>
  const callRooms = new Map() // Map<chatId, Set<userId>>
  const typingUsers = new Map() // Map<chatId, Map<userId, timeoutId>>

  // Handle WebSocket upgrade
  server.on('upgrade', (request, socket, head) => {
    const pathname = url.parse(request.url).pathname

    console.log(`🔌 WebSocket upgrade request: ${pathname}`)

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

    // Store connection with metadata
    clients.set(userId, {
      ws,
      userId,
      chatId,
      online: true,
      lastActivity: Date.now(),
    })

    console.log(`✅ User connected: ${userId} on ${pathname}`)

    // If chatId provided, add to call room
    if (chatId) {
      if (!callRooms.has(chatId)) {
        callRooms.set(chatId, new Set())
      }
      callRooms.get(chatId).add(userId)
      console.log(`📞 User ${userId} joined call room: ${chatId}`)

      broadcastToRoom(chatId, userId, {
        type: 'user-joined',
        userId,
        chatId,
      })
    }

    // Broadcast online status to all users
    broadcastToAll({
      type: 'user-online',
      userId,
      timestamp: new Date().toISOString(),
    })

    // Send connection confirmation
    ws.send(
      JSON.stringify({
        type: 'connected',
        userId,
        timestamp: new Date().toISOString(),
        onlineUsers: Array.from(clients.keys()),
      })
    )

    // Handle messages
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

    // Handle disconnection
    ws.on('close', () => {
      clients.delete(userId)

      // Broadcast offline status
      broadcastToAll({
        type: 'user-offline',
        userId,
        timestamp: new Date().toISOString(),
      })

      // Clear typing indicators
      typingUsers.forEach((chatTyping, chatId) => {
        if (chatTyping.has(userId)) {
          const timeoutId = chatTyping.get(userId)
          clearTimeout(timeoutId)
          chatTyping.delete(userId)

          // Notify others in chat
          broadcastToChatMembers(chatId, userId, {
            type: 'typing-stopped',
            userId,
            chatId,
          })
        }
      })

      // Remove from call rooms
      callRooms.forEach((users, roomChatId) => {
        if (users.has(userId)) {
          users.delete(userId)
          broadcastToRoom(roomChatId, userId, {
            type: 'user-left',
            userId,
            chatId: roomChatId,
          })

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
      // ===== CALL SIGNALING =====
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

      case 'screen-sharing':
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

      // ===== MESSAGING =====
      case 'new-message':
        handleNewMessage(senderId, data)
        break

      case 'message-delivered':
        handleMessageDelivered(senderId, data)
        break

      case 'message-read':
        handleMessageRead(senderId, data)
        break

      // ===== TYPING INDICATORS =====
      case 'typing-start':
        handleTypingStart(senderId, data)
        break

      case 'typing-stop':
        handleTypingStop(senderId, data)
        break

      // ===== PRESENCE =====
      case 'update-status':
        handleStatusUpdate(senderId, data)
        break

      case 'ping':
        const socket = clients.get(senderId)
        if (socket && socket.ws.readyState === socket.ws.OPEN) {
          socket.ws.send(JSON.stringify({ type: 'pong' }))
          socket.lastActivity = Date.now()
        }
        break

      default:
        console.warn('⚠️ Unknown message type:', data.type)
    }
  }

  // ===== CALL HANDLERS =====
  function handleJoinCall(userId, data) {
    const { chatId } = data

    if (!callRooms.has(chatId)) {
      callRooms.set(chatId, new Set())
    }

    callRooms.get(chatId).add(userId)
    console.log(`📞 User ${userId} joined call room: ${chatId}`)

    broadcastToRoom(chatId, userId, {
      type: 'user-joined',
      userId,
      chatId,
    })
  }

  function handleEndCall(userId, data) {
    const { chatId } = data

    broadcastToRoom(chatId, null, {
      type: 'call-ended',
      userId,
      chatId,
    })

    if (callRooms.has(chatId)) {
      callRooms.get(chatId).delete(userId)

      if (callRooms.get(chatId).size === 0) {
        callRooms.delete(chatId)
      }
    }

    console.log(`🔴 User ${userId} ended call in room: ${chatId}`)
  }

  // ===== MESSAGE HANDLERS =====
  function handleNewMessage(senderId, data) {
    const { chatId, message, participants } = data

    console.log(`💬 New message in chat ${chatId} from ${senderId}`)

    // Broadcast to all chat participants except sender
    participants.forEach((participantId) => {
      if (participantId !== senderId) {
        forwardToUser(participantId, {
          type: 'new_message',
          chatId,
          message,
          senderId,
          timestamp: new Date().toISOString(),
        })
      }
    })

    // Stop typing indicator for sender
    handleTypingStop(senderId, { chatId })
  }

  function handleMessageDelivered(userId, data) {
    const { messageId, chatId, senderId } = data

    forwardToUser(senderId, {
      type: 'message-delivered',
      messageId,
      chatId,
      deliveredBy: userId,
      timestamp: new Date().toISOString(),
    })
  }

  function handleMessageRead(userId, data) {
    const { messageId, chatId, senderId } = data

    forwardToUser(senderId, {
      type: 'message-read',
      messageId,
      chatId,
      readBy: userId,
      timestamp: new Date().toISOString(),
    })
  }

  // ===== TYPING HANDLERS =====
  function handleTypingStart(userId, data) {
    const { chatId, participants } = data

    if (!typingUsers.has(chatId)) {
      typingUsers.set(chatId, new Map())
    }

    const chatTyping = typingUsers.get(chatId)

    // Clear existing timeout
    if (chatTyping.has(userId)) {
      clearTimeout(chatTyping.get(userId))
    }

    // Set new timeout (auto-stop after 5 seconds)
    const timeoutId = setTimeout(() => {
      handleTypingStop(userId, { chatId, participants })
    }, 5000)

    chatTyping.set(userId, timeoutId)

    // Broadcast to chat participants
    participants.forEach((participantId) => {
      if (participantId !== userId) {
        forwardToUser(participantId, {
          type: 'typing',
          userId,
          chatId,
          isTyping: true,
        })
      }
    })

    console.log(`⌨️ User ${userId} started typing in chat ${chatId}`)
  }

  function handleTypingStop(userId, data) {
    const { chatId, participants } = data

    if (typingUsers.has(chatId)) {
      const chatTyping = typingUsers.get(chatId)

      if (chatTyping.has(userId)) {
        clearTimeout(chatTyping.get(userId))
        chatTyping.delete(userId)
      }
    }

    // Broadcast to chat participants
    if (participants) {
      participants.forEach((participantId) => {
        if (participantId !== userId) {
          forwardToUser(participantId, {
            type: 'typing',
            userId,
            chatId,
            isTyping: false,
          })
        }
      })
    }

    console.log(`⌨️ User ${userId} stopped typing in chat ${chatId}`)
  }

  // ===== STATUS HANDLERS =====
  function handleStatusUpdate(userId, data) {
    const { status, customMessage } = data

    const client = clients.get(userId)
    if (client) {
      client.status = status
      client.customMessage = customMessage
    }

    broadcastToAll({
      type: 'user-status-updated',
      userId,
      status,
      customMessage,
      timestamp: new Date().toISOString(),
    })

    console.log(`📍 User ${userId} status updated to: ${status}`)
  }

  // ===== UTILITY FUNCTIONS =====
  function forwardToUser(userId, message) {
    const client = clients.get(userId)

    if (client && client.ws.readyState === client.ws.OPEN) {
      client.ws.send(JSON.stringify(message))
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

  function broadcastToChatMembers(chatId, excludeUserId, message) {
    // This requires knowing chat participants - you'll need to pass this info
    // For now, we'll broadcast to all connected users in that chat
    clients.forEach((client, userId) => {
      if (userId !== excludeUserId && client.chatId === chatId) {
        forwardToUser(userId, message)
      }
    })
  }

  function broadcastToAll(message, excludeUserId = null) {
    clients.forEach((client, userId) => {
      if (userId !== excludeUserId) {
        forwardToUser(userId, message)
      }
    })
  }

  // Keep-alive ping every 30 seconds
  setInterval(() => {
    const now = Date.now()
    clients.forEach((client, userId) => {
      if (client.ws.readyState === client.ws.OPEN) {
        // Check if client is inactive (no activity for 5 minutes)
        if (now - client.lastActivity > 300000) {
          console.warn(`⚠️ Client ${userId} inactive, closing connection`)
          client.ws.close(1000, 'Inactive')
          return
        }

        client.ws.send(JSON.stringify({ type: 'ping' }))
      }
    })
  }, 30000)

  // Cleanup inactive connections every minute
  setInterval(() => {
    const now = Date.now()
    clients.forEach((client, userId) => {
      if (client.ws.readyState !== client.ws.OPEN) {
        clients.delete(userId)
        console.log(`🧹 Cleaned up closed connection for user ${userId}`)
      }
    })
  }, 60000)

  console.log('✅ WebRTC signaling server initialized')
  console.log('📡 Accepting connections on: /, /notifications, /signaling')

  return clients
}

module.exports = { setupSignalingServer }
