// signalingServer.js - Fixed to support multiple connections per user
const { WebSocketServer } = require('ws')
const url = require('url')

function setupSignalingServer(server) {
  const wss = new WebSocketServer({ noServer: true })

  // NEW: Separate connection maps per endpoint to avoid conflicts
  const notificationClients = new Map() // Map<userId, {ws, metadata}>
  const postsClients = new Map() // Map<userId, {ws, metadata}>
  const signalingClients = new Map() // Map<userId, {ws, metadata}>

  const callRooms = new Map() // Map<chatId, Set<userId>>
  const typingUsers = new Map() // Map<chatId, Map<userId, timeoutId>>

  // Helper to get the correct client map for an endpoint
  function getClientMap(endpoint) {
    if (endpoint === '/posts') return postsClients
    if (endpoint === '/signaling') return signalingClients
    return notificationClients // default for /notifications and /
  }

  // Helper to get all online users across all endpoints
  function getAllOnlineUsers() {
    const users = new Set()
    notificationClients.forEach((_, userId) => users.add(userId))
    postsClients.forEach((_, userId) => users.add(userId))
    signalingClients.forEach((_, userId) => users.add(userId))
    return Array.from(users)
  }

  // Handle WebSocket upgrade
  server.on('upgrade', (request, socket, head) => {
    const pathname = url.parse(request.url).pathname

    console.log(`🔌 WebSocket upgrade request: ${pathname}`)

    if (
      pathname === '/' ||
      pathname === '/notifications' ||
      pathname === '/signaling' ||
      pathname === '/posts'
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

    // Get the appropriate client map for this endpoint
    const clients = getClientMap(pathname)

    // Close existing connection for this user on THIS endpoint if any
    const existingClient = clients.get(userId)
    if (
      existingClient &&
      existingClient.ws.readyState === existingClient.ws.OPEN
    ) {
      console.log(
        `⚠️ Closing existing connection for user: ${userId} on ${pathname}`
      )
      existingClient.ws.close(1000, 'New connection established')
    }

    // Store connection with metadata in the correct map
    clients.set(userId, {
      ws,
      userId,
      chatId,
      pathname,
      online: true,
      lastActivity: Date.now(),
      connectedAt: Date.now(),
    })

    console.log(`✅ User connected: ${userId} on ${pathname}`)
    console.log(
      `📊 Connections - Notifications: ${notificationClients.size}, Posts: ${postsClients.size}, Signaling: ${signalingClients.size}`
    )

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

    // Broadcast online status to all users on ALL endpoints
    const onlineMessage = {
      type: 'user-online',
      userId,
      timestamp: new Date().toISOString(),
    }
    broadcastToEndpoint('/notifications', onlineMessage)
    broadcastToEndpoint('/posts', onlineMessage)

    // Send connection confirmation
    ws.send(
      JSON.stringify({
        type: 'connected',
        userId,
        timestamp: new Date().toISOString(),
        onlineUsers: getAllOnlineUsers(),
        endpoint: pathname,
      })
    )

    // Handle messages
    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message)
        handleSignalMessage(userId, pathname, data)
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
      console.log(`❌ User disconnected: ${userId} from ${pathname}`)
      console.log(
        `📊 Connections - Notifications: ${notificationClients.size}, Posts: ${postsClients.size}, Signaling: ${signalingClients.size}`
      )

      // Only broadcast offline if user is not connected on ANY endpoint
      const stillConnected =
        notificationClients.has(userId) ||
        postsClients.has(userId) ||
        signalingClients.has(userId)

      if (!stillConnected) {
        const offlineMessage = {
          type: 'user-offline',
          userId,
          timestamp: new Date().toISOString(),
        }
        broadcastToEndpoint('/notifications', offlineMessage)
        broadcastToEndpoint('/posts', offlineMessage)
      }

      // Clear typing indicators
      typingUsers.forEach((chatTyping, chatId) => {
        if (chatTyping.has(userId)) {
          const timeoutId = chatTyping.get(userId)
          clearTimeout(timeoutId)
          chatTyping.delete(userId)

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
    })

    ws.on('error', (error) => {
      console.error(`❌ WebSocket error for user ${userId}:`, error.message)
    })
  })

  // Handle signaling messages
  function handleSignalMessage(senderId, endpoint, data) {
    console.log(`📨 Message from ${senderId} on ${endpoint}:`, data.type)
    console.log(`📦 Message data:`, JSON.stringify(data, null, 2))

    // Update last activity on the correct client map
    const clients = getClientMap(endpoint)
    const client = clients.get(senderId)
    if (client) {
      client.lastActivity = Date.now()
    } else {
      console.warn(`⚠️ Client ${senderId} not found in ${endpoint} map!`)
    }

    switch (data.type) {
      // ===== CALL SIGNALING =====
      case 'join-call':
        handleJoinCall(senderId, data)
        break

      case 'webrtc-offer':
        forwardToUser(
          data.to,
          {
            type: 'webrtc-offer',
            offer: data.offer,
            from: senderId,
            chatId: data.chatId,
          },
          '/signaling'
        )
        break

      case 'webrtc-answer':
        forwardToUser(
          data.to,
          {
            type: 'webrtc-answer',
            answer: data.answer,
            from: senderId,
            chatId: data.chatId,
          },
          '/signaling'
        )
        break

      case 'webrtc-ice-candidate':
        forwardToUser(
          data.to,
          {
            type: 'webrtc-ice-candidate',
            candidate: data.candidate,
            from: senderId,
            chatId: data.chatId,
          },
          '/signaling'
        )
        break

      case 'screen-sharing':
        forwardToUser(
          data.to,
          {
            type: 'screen-sharing',
            enabled: data.enabled,
            from: senderId,
            chatId: data.chatId,
          },
          '/signaling'
        )
        break

      case 'call-answered':
      case 'call_accepted':
        console.log('📞 Call answered/accepted')

        // Send to caller (initiator)
        if (data.to) {
          forwardToUser(
            data.to,
            {
              type: 'call-accepted',
              from: data.from || senderId,
              chatId: data.chatId,
              timestamp: new Date().toISOString(),
            },
            '/signaling'
          )
          console.log(`✅ Notified caller ${data.to} that call was accepted`)
        }

        // ✅ NEW: Also confirm to the answerer
        forwardToUser(
          senderId,
          {
            type: 'call-accepted-confirmed',
            from: senderId,
            to: data.to,
            chatId: data.chatId,
            timestamp: new Date().toISOString(),
          },
          '/signaling'
        )
        console.log(
          `✅ Confirmed to answerer ${senderId} to proceed with WebRTC`
        )

        break

      // ===== MESSAGING =====
      case 'new-message':
        handleNewMessage(senderId, data)
        break

      case 'message-updated':
        handleMessageUpdated(senderId, data)
        break

      case 'message-deleted':
        handleMessageDeleted(senderId, data)
        break

      case 'message-delivered':
        handleMessageDelivered(senderId, data)
        break

      case 'message-read':
        handleMessageRead(senderId, data)
        break

      // ===== POSTS & STATUSES =====
      case 'new-post':
        handleNewPost(senderId, data)
        break

      case 'post-updated':
        handlePostUpdated(senderId, data)
        break

      case 'post-deleted':
        handlePostDeleted(senderId, data)
        break

      case 'post-liked':
        handlePostLiked(senderId, data)
        break

      case 'post-unliked':
        handlePostUnliked(senderId, data)
        break

      case 'new-status':
        handleNewStatus(senderId, data)
        break

      case 'status-deleted':
        handleStatusDeleted(senderId, data)
        break

      // ===== TYPING INDICATORS =====
      case 'typing-start':
        handleTypingStart(senderId, data)
        break

      case 'typing-stop':
        handleTypingStop(senderId, data)
        break

      case 'update-last-seen':
        handleLastSeenUpdate(senderId, data)
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
    const { chatId, remoteUserId, reason } = data

    console.log(`🔴 User ${userId} ending call in room: ${chatId}`, {
      reason,
      remoteUserId,
    })

    const messageType = 'call-ended'

    if (remoteUserId) {
      forwardToUser(
        remoteUserId,
        {
          type: messageType,
          userId,
          chatId,
          reason: reason || 'user_ended',
          timestamp: new Date().toISOString(),
        },
        '/notifications'
      )
      console.log(`✅ Sent call-ended to specific user: ${remoteUserId}`)
    }

    broadcastToRoom(chatId, userId, {
      type: messageType,
      userId,
      chatId,
      reason: reason || 'user_ended',
      timestamp: new Date().toISOString(),
    })

    if (callRooms.has(chatId)) {
      callRooms.get(chatId).delete(userId)

      if (callRooms.get(chatId).size === 0) {
        callRooms.delete(chatId)
        console.log(`🧹 Call room ${chatId} cleaned up`)
      }
    }

    console.log(`✅ Call ended notification sent for room: ${chatId}`)
  }

  // ===== MESSAGE HANDLERS (sent to /notifications clients) =====
  function handleNewMessage(senderId, data) {
    const { chatId, message, participants } = data

    console.log(`💬 New message in chat ${chatId} from ${senderId}`)
    console.log(`👥 Participants:`, participants)
    console.log(`📊 Total notification clients:`, notificationClients.size)
    console.log(
      `📋 Notification clients list:`,
      Array.from(notificationClients.keys())
    )

    if (!participants || !Array.isArray(participants)) {
      console.error('❌ Invalid participants list:', participants)
      return
    }

    // Send to all participants EXCEPT the sender on /notifications endpoint
    let sentCount = 0
    let skippedSender = false

    participants.forEach((participantId) => {
      const participantStr = String(participantId)
      const senderStr = String(senderId)

      console.log(
        `  Checking participant "${participantStr}" vs sender "${senderStr}"`
      )

      if (participantStr === senderStr) {
        console.log(`  ⏭️ Skipping sender (exact match)`)
        skippedSender = true
        return
      }

      // Check if client exists on notifications endpoint
      if (!notificationClients.has(participantStr)) {
        console.warn(
          `  ⚠️ Participant ${participantStr} not connected to /notifications`
        )
        return
      }

      const success = forwardToUser(
        participantStr,
        {
          type: 'new-message',
          chatId,
          message,
          senderId,
          timestamp: new Date().toISOString(),
        },
        '/notifications'
      )

      if (success) {
        sentCount++
        console.log(`  ✅ Sent to ${participantStr}`)
      } else {
        console.log(`  ❌ Failed to send to ${participantStr}`)
      }
    })

    console.log(`✅ Message broadcast complete:`)
    console.log(`   - Total participants: ${participants.length}`)
    console.log(`   - Sender skipped: ${skippedSender}`)
    console.log(`   - Successfully sent: ${sentCount}`)
    console.log(`   - Expected recipients: ${participants.length - 1}`)

    handleTypingStop(senderId, { chatId })
  }

  function handleMessageDelivered(userId, data) {
    const { messageId, chatId, senderId } = data

    forwardToUser(
      senderId,
      {
        type: 'message-delivered',
        messageId,
        chatId,
        deliveredBy: userId,
        timestamp: new Date().toISOString(),
      },
      '/notifications'
    )
  }

  function handleMessageRead(userId, data) {
    const { messageId, chatId, senderId } = data

    forwardToUser(
      senderId,
      {
        type: 'message-read',
        messageId,
        chatId,
        readBy: userId,
        timestamp: new Date().toISOString(),
      },
      '/notifications'
    )
  }

  function handleMessageUpdated(senderId, data) {
    const { chatId, messageId, message, participants } = data

    console.log(`✏️ Message updated in chat ${chatId} by ${senderId}`)

    // Send to all participants EXCEPT the sender
    participants.forEach((participantId) => {
      if (participantId !== senderId) {
        forwardToUser(
          participantId,
          {
            type: 'message-updated',
            chatId,
            messageId,
            message,
            senderId,
            timestamp: new Date().toISOString(),
          },
          '/notifications'
        )
      }
    })
  }

  function handleMessageDeleted(senderId, data) {
    const { chatId, messageId, participants } = data

    console.log(`🗑️ Message deleted in chat ${chatId} by ${senderId}`)

    // Send to all participants EXCEPT the sender
    participants.forEach((participantId) => {
      if (participantId !== senderId) {
        forwardToUser(
          participantId,
          {
            type: 'message-deleted',
            chatId,
            messageId,
            senderId,
            timestamp: new Date().toISOString(),
          },
          '/notifications'
        )
      }
    })
  }

  // ===== POST HANDLERS (sent to /posts clients) =====
  function handleNewPost(senderId, data) {
    const { post } = data

    console.log(`📝 Broadcasting new post from ${senderId}:`, post._id)
    console.log(
      `📊 Broadcasting to ${postsClients.size - 1} other posts clients`
    )

    // Broadcast to all /posts clients EXCEPT sender
    broadcastToEndpoint(
      '/posts',
      {
        type: 'new-post',
        post,
        senderId,
        timestamp: new Date().toISOString(),
      },
      senderId
    )
  }

  function handlePostUpdated(senderId, data) {
    const { postId, post } = data

    console.log(`✏️ Broadcasting post update from ${senderId}:`, postId)

    broadcastToEndpoint(
      '/posts',
      {
        type: 'post-updated',
        postId,
        post,
        senderId,
        timestamp: new Date().toISOString(),
      },
      senderId
    )
  }

  function handlePostDeleted(senderId, data) {
    const { postId } = data

    console.log(`🗑️ Broadcasting post deletion from ${senderId}:`, postId)

    broadcastToEndpoint(
      '/posts',
      {
        type: 'post-deleted',
        postId,
        senderId,
        timestamp: new Date().toISOString(),
      },
      senderId
    )
  }

  function handlePostLiked(senderId, data) {
    const { postId, newLikeCount } = data

    console.log(`❤️ Broadcasting post like from ${senderId}:`, postId)

    broadcastToEndpoint(
      '/posts',
      {
        type: 'post-liked',
        postId,
        userId: senderId,
        newLikeCount,
        timestamp: new Date().toISOString(),
      },
      senderId
    )
  }

  function handlePostUnliked(senderId, data) {
    const { postId, newLikeCount } = data

    console.log(`💔 Broadcasting post unlike from ${senderId}:`, postId)

    broadcastToEndpoint(
      '/posts',
      {
        type: 'post-unliked',
        postId,
        userId: senderId,
        newLikeCount,
        timestamp: new Date().toISOString(),
      },
      senderId
    )
  }

  function handleNewStatus(senderId, data) {
    const { status } = data

    console.log(`📸 Broadcasting new status from ${senderId}:`, status._id)
    console.log(
      `📊 Broadcasting to ${postsClients.size - 1} other posts clients`
    )

    // Broadcast to all /posts clients EXCEPT sender
    broadcastToEndpoint(
      '/posts',
      {
        type: 'new-status',
        status,
        userId: senderId,
        timestamp: new Date().toISOString(),
      },
      senderId
    )
  }

  function handleStatusDeleted(senderId, data) {
    const { statusId } = data

    console.log(`🗑️ Broadcasting status deletion from ${senderId}:`, statusId)

    broadcastToEndpoint(
      '/posts',
      {
        type: 'status-deleted',
        statusId,
        userId: senderId,
        timestamp: new Date().toISOString(),
      },
      senderId
    )
  }

  // ===== TYPING HANDLERS =====
  function handleTypingStart(userId, data) {
    const { chatId, participants } = data

    if (!typingUsers.has(chatId)) {
      typingUsers.set(chatId, new Map())
    }

    const chatTyping = typingUsers.get(chatId)

    if (chatTyping.has(userId)) {
      clearTimeout(chatTyping.get(userId))
    }

    const timeoutId = setTimeout(() => {
      handleTypingStop(userId, { chatId, participants })
    }, 5000)

    chatTyping.set(userId, timeoutId)

    participants.forEach((participantId) => {
      if (participantId !== userId) {
        forwardToUser(
          participantId,
          {
            type: 'typing',
            userId,
            chatId,
            isTyping: true,
          },
          '/notifications'
        )
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

    if (participants) {
      participants.forEach((participantId) => {
        if (participantId !== userId) {
          forwardToUser(
            participantId,
            {
              type: 'typing',
              userId,
              chatId,
              isTyping: false,
            },
            '/notifications'
          )
        }
      })
    }

    console.log(`⌨️ User ${userId} stopped typing in chat ${chatId}`)
  }

  function handleLastSeenUpdate(userId, data) {
    const { chatId, participants } = data

    const client = notificationClients.get(userId)
    if (client) {
      client.lastSeen = Date.now()
    }

    if (participants) {
      participants.forEach((participantId) => {
        if (participantId !== userId) {
          forwardToUser(
            participantId,
            {
              type: 'user-last-seen',
              userId,
              chatId,
              timestamp: new Date().toISOString(),
            },
            '/notifications'
          )
        }
      })
    }

    console.log(`👁️ User ${userId} last seen updated in chat ${chatId}`)
  }

  // ===== STATUS HANDLERS =====
  function handleStatusUpdate(userId, data) {
    const { status, customMessage } = data

    const client = notificationClients.get(userId)
    if (client) {
      client.status = status
      client.customMessage = customMessage
    }

    const message = {
      type: 'user-status-updated',
      userId,
      status,
      customMessage,
      timestamp: new Date().toISOString(),
    }

    broadcastToEndpoint('/notifications', message)
    broadcastToEndpoint('/posts', message)

    console.log(`📍 User ${userId} status updated to: ${status}`)
  }

  // ===== UTILITY FUNCTIONS =====
  function forwardToUser(userId, message, endpoint = '/notifications') {
    const clients = getClientMap(endpoint)
    const client = clients.get(userId)

    if (!client) {
      console.warn(`⚠️ User ${userId} not found on ${endpoint}`)
      console.warn(
        `   Available users on ${endpoint}:`,
        Array.from(clients.keys())
      )
      return false
    }

    if (client.ws.readyState !== client.ws.OPEN) {
      console.warn(
        `⚠️ User ${userId} socket not ready on ${endpoint} (state: ${client.ws.readyState})`
      )
      return false
    }

    try {
      client.ws.send(JSON.stringify(message))
      console.log(`✉️ Forwarded ${message.type} to ${userId} on ${endpoint}`)
      return true
    } catch (err) {
      console.error(
        `❌ Failed to send to ${userId} on ${endpoint}:`,
        err.message
      )
      return false
    }
  }

  function broadcastToEndpoint(endpoint, message, excludeUserId = null) {
    const clients = getClientMap(endpoint)
    let broadcastCount = 0
    let failedCount = 0

    clients.forEach((client, userId) => {
      if (userId !== excludeUserId && client.ws.readyState === client.ws.OPEN) {
        try {
          client.ws.send(JSON.stringify(message))
          broadcastCount++
        } catch (err) {
          console.error(
            `❌ Broadcast failed to ${userId} on ${endpoint}:`,
            err.message
          )
          failedCount++
        }
      }
    })

    console.log(
      `📡 ${endpoint} broadcast: ${broadcastCount} sent, ${failedCount} failed${
        excludeUserId ? ', 1 excluded' : ''
      }`
    )
  }

  function broadcastToRoom(chatId, excludeUserId, message) {
    const room = callRooms.get(chatId)

    if (!room) {
      console.warn(`⚠️ Room ${chatId} not found`)
      return
    }

    room.forEach((userId) => {
      if (userId !== excludeUserId) {
        forwardToUser(userId, message, '/notifications')
      }
    })
  }

  function broadcastToChatMembers(chatId, excludeUserId, message) {
    notificationClients.forEach((client, userId) => {
      if (userId !== excludeUserId && client.chatId === chatId) {
        forwardToUser(userId, message, '/notifications')
      }
    })
  }

  // Keep-alive ping every 30 seconds
  setInterval(() => {
    const now = Date.now()

    ;[notificationClients, postsClients, signalingClients].forEach(
      (clients, idx) => {
        const endpoint = ['/notifications', '/posts', '/signaling'][idx]

        clients.forEach((client, userId) => {
          if (client.ws.readyState === client.ws.OPEN) {
            if (now - client.lastActivity > 300000) {
              console.warn(
                `⚠️ Client ${userId} on ${endpoint} inactive, closing`
              )
              client.ws.close(1000, 'Inactive')
              return
            }

            try {
              client.ws.send(JSON.stringify({ type: 'ping' }))
            } catch (err) {
              console.error(
                `❌ Failed to ping ${userId} on ${endpoint}:`,
                err.message
              )
            }
          }
        })
      }
    )
  }, 30000)

  // Cleanup inactive connections every minute
  setInterval(() => {
    ;[notificationClients, postsClients, signalingClients].forEach(
      (clients, idx) => {
        const endpoint = ['/notifications', '/posts', '/signaling'][idx]

        clients.forEach((client, userId) => {
          if (client.ws.readyState !== client.ws.OPEN) {
            clients.delete(userId)
            console.log(
              `🧹 Cleaned up closed connection for ${userId} on ${endpoint}`
            )
          }
        })
      }
    )
  }, 60000)

  console.log('✅ WebRTC signaling server initialized')
  console.log(
    '📡 Accepting connections on: /, /notifications, /signaling, /posts'
  )
  console.log('🔀 Supporting multiple concurrent connections per user')

  // For backward compatibility with backend routes that use global.wsClients
  // Create a unified Map that includes all clients
  const unifiedClientsMap = new Map()

  // Create a Proxy to dynamically merge all client maps
  const wsClientsProxy = new Proxy(unifiedClientsMap, {
    get(target, prop) {
      // Return size from all maps combined
      if (prop === 'size') {
        return (
          notificationClients.size + postsClients.size + signalingClients.size
        )
      }

      // Return combined keys iterator
      if (prop === 'keys') {
        return function () {
          const allKeys = new Set([
            ...notificationClients.keys(),
            ...postsClients.keys(),
            ...signalingClients.keys(),
          ])
          return allKeys.keys()
        }
      }

      // Return combined values iterator
      if (prop === 'values') {
        return function () {
          const allValues = [
            ...notificationClients.values(),
            ...postsClients.values(),
            ...signalingClients.values(),
          ]
          return allValues.values()
        }
      }

      // Return combined entries iterator
      if (prop === 'entries') {
        return function () {
          const allEntries = [
            ...notificationClients.entries(),
            ...postsClients.entries(),
            ...signalingClients.entries(),
          ]
          return allEntries.entries()
        }
      }

      // forEach implementation
      if (prop === 'forEach') {
        return function (callback, thisArg) {
          notificationClients.forEach(callback, thisArg)
          postsClients.forEach(callback, thisArg)
          signalingClients.forEach(callback, thisArg)
        }
      }

      // has implementation - check all maps
      if (prop === 'has') {
        return function (key) {
          return (
            notificationClients.has(key) ||
            postsClients.has(key) ||
            signalingClients.has(key)
          )
        }
      }

      // get implementation - check notifications first, then posts, then signaling
      if (prop === 'get') {
        return function (key) {
          return (
            notificationClients.get(key) ||
            postsClients.get(key) ||
            signalingClients.get(key)
          )
        }
      }

      return target[prop]
    },
  })

  return {
    notificationClients,
    postsClients,
    signalingClients,
    wsClients: wsClientsProxy, // For backward compatibility
  }
}

module.exports = { setupSignalingServer }
