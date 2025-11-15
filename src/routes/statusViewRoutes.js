// routes/statusViewRoutes.js - Track status views
const { getCollections } = require('../db')
const { verifyAuthToken } = require('../middleware/verifyAuthToken')
const { ObjectId } = require('mongodb')

// ✅ Helper function to broadcast to WebSocket clients
function broadcastToWebSocket(clients, message, targetUserId = null) {
  if (!clients || typeof clients.forEach !== 'function') {
    console.warn('⚠️ WebSocket clients not available for broadcasting')
    return
  }

  let broadcastCount = 0
  clients.forEach((client, userId) => {
    // If targetUserId is specified, only send to that user
    // Otherwise, broadcast to everyone except sender
    const shouldSend = targetUserId
      ? userId === targetUserId
      : userId !== message.viewerId

    if (shouldSend && client.ws.readyState === 1) {
      try {
        client.ws.send(JSON.stringify(message))
        broadcastCount++
      } catch (error) {
        console.error(`Failed to send to ${userId}:`, error.message)
      }
    }
  })

  console.log(`📡 Broadcasted ${message.type} to ${broadcastCount} users`)
}

// POST /status/:statusId/view - Mark status as viewed
const markStatusViewedRoute = {
  path: '/status/:statusId/view',
  method: 'post',
  middleware: [verifyAuthToken],
  handler: async (req, res) => {
    console.log('\n=== Mark Status Viewed ===')
    console.log('Status ID:', req.params.statusId)
    console.log('Viewer UID:', req.user?.uid)

    try {
      const { statuses, users } = getCollections()
      const statusId = req.params.statusId
      const viewerId = req.user.uid

      // Find the status
      const status = await statuses.findOne({
        _id: new ObjectId(statusId),
      })

      if (!status) {
        return res.status(404).json({
          success: false,
          error: 'Status not found',
        })
      }

      // Don't track views from the status owner
      if (status.userId === viewerId) {
        console.log('⏭️ Skipping view tracking for status owner')
        return res.json({
          success: true,
          message: 'Own status view not tracked',
        })
      }

      // Get viewer info
      const viewer = await users.findOne({ firebaseUid: viewerId })
      if (!viewer) {
        return res.status(404).json({
          success: false,
          error: 'Viewer not found',
        })
      }

      const now = new Date()

      // Check if already viewed
      const existingView = await statuses.findOne({
        _id: new ObjectId(statusId),
        'views.userId': viewerId,
      })

      if (existingView) {
        console.log('👁️ Status already viewed, updating timestamp')
        // Update existing view timestamp
        await statuses.updateOne(
          {
            _id: new ObjectId(statusId),
            'views.userId': viewerId,
          },
          {
            $set: {
              'views.$.viewedAt': now,
            },
          }
        )
      } else {
        console.log('✅ Recording new status view')
        // Add new view
        await statuses.updateOne(
          { _id: new ObjectId(statusId) },
          {
            $push: {
              views: {
                userId: viewerId,
                userName: viewer.name || 'User',
                userAvatarColor: viewer.avatarColor || '#3498db',
                viewedAt: now,
              },
            },
          }
        )
      }

      // Get updated status
      const updatedStatus = await statuses.findOne({
        _id: new ObjectId(statusId),
      })

      // ✅ Broadcast view event to status owner
      if (req.app.wsClients) {
        broadcastToWebSocket(
          req.app.wsClients,
          {
            type: 'status-viewed',
            statusId,
            statusOwnerId: status.userId,
            viewer: {
              userId: viewerId,
              userName: viewer.name || 'User',
              userAvatarColor: viewer.avatarColor || '#3498db',
            },
            viewCount: updatedStatus.views?.length || 0,
            timestamp: now.toISOString(),
          },
          status.userId // Send only to status owner
        )
      }

      console.log(`👁️ Status ${statusId} viewed by ${viewer.name}`)
      console.log(`Total views: ${updatedStatus.views?.length || 0}`)

      res.json({
        success: true,
        viewCount: updatedStatus.views?.length || 0,
      })
    } catch (err) {
      console.error('❌ Mark status viewed error:', err)
      res.status(500).json({
        success: false,
        error: 'Failed to mark status as viewed',
        details: err.message,
      })
    }
  },
}

// GET /status/:statusId/views - Get all viewers of a status
const getStatusViewsRoute = {
  path: '/status/:statusId/views',
  method: 'get',
  middleware: [verifyAuthToken],
  handler: async (req, res) => {
    console.log('\n=== Get Status Views ===')
    console.log('Status ID:', req.params.statusId)
    console.log('Requester UID:', req.user?.uid)

    try {
      const { statuses } = getCollections()
      const statusId = req.params.statusId

      const status = await statuses.findOne({
        _id: new ObjectId(statusId),
      })

      if (!status) {
        return res.status(404).json({
          success: false,
          error: 'Status not found',
        })
      }

      // Only status owner can see who viewed
      if (status.userId !== req.user.uid) {
        return res.status(403).json({
          success: false,
          error: 'Only status owner can see views',
        })
      }

      const views = status.views || []

      // Sort by most recent first
      views.sort((a, b) => new Date(b.viewedAt) - new Date(a.viewedAt))

      console.log(`✅ Found ${views.length} views for status`)

      res.json({
        success: true,
        views,
        viewCount: views.length,
      })
    } catch (err) {
      console.error('❌ Get status views error:', err)
      res.status(500).json({
        success: false,
        error: 'Failed to fetch status views',
        details: err.message,
      })
    }
  },
}

// GET /status/my/views-summary - Get view counts for all user's statuses
const getMyStatusViewsSummaryRoute = {
  path: '/status/my/views-summary',
  method: 'get',
  middleware: [verifyAuthToken],
  handler: async (req, res) => {
    console.log('\n=== Get My Status Views Summary ===')
    console.log('User UID:', req.user?.uid)

    try {
      const { statuses } = getCollections()
      const now = new Date()

      // Get all active statuses for user with view counts
      const myStatuses = await statuses
        .find({
          userId: req.user.uid,
          expiresAt: { $gt: now },
        })
        .project({
          _id: 1,
          fileUrl: 1,
          fileType: 1,
          caption: 1,
          createdAt: 1,
          expiresAt: 1,
          viewCount: { $size: { $ifNull: ['$views', []] } },
          views: 1,
        })
        .sort({ createdAt: -1 })
        .toArray()

      console.log(`✅ Found ${myStatuses.length} active statuses`)

      res.json({
        success: true,
        statuses: myStatuses.map((s) => ({
          ...s,
          viewCount: s.views?.length || 0,
          hasViews: (s.views?.length || 0) > 0,
        })),
      })
    } catch (err) {
      console.error('❌ Get my status views summary error:', err)
      res.status(500).json({
        success: false,
        error: 'Failed to fetch views summary',
        details: err.message,
      })
    }
  },
}

module.exports = {
  markStatusViewedRoute,
  getStatusViewsRoute,
  getMyStatusViewsSummaryRoute,
}
