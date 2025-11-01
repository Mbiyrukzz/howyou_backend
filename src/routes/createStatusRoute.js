// routes/createStatusRoute.js - Enhanced with 5 status per day limit
const { getCollections } = require('../db')
const {
  uploadMultiple,
  getFileInfo,
} = require('../middleware/createUploadsDir')
const { verifyAuthToken } = require('../middleware/verifyAuthToken')

const SERVER_BASE_URL = process.env.SERVER_BASE_URL || 'http://localhost:5000'
const MAX_STATUSES_PER_DAY = 5

const createStatusRoute = {
  path: '/status',
  method: 'post',
  middleware: [verifyAuthToken, uploadMultiple('files', 1)],
  handler: async (req, res) => {
    console.log('\n=== Create Status Request ===')
    console.log('User UID:', req.user?.uid)
    console.log('Body:', req.body)
    console.log('Files received:', req.files?.length || 0)

    if (req.files && req.files.length > 0) {
      console.log('File details:', {
        fieldname: req.files[0].fieldname,
        originalname: req.files[0].originalname,
        mimetype: req.files[0].mimetype,
        size: req.files[0].size,
        path: req.files[0].path,
      })
    }

    try {
      const { caption } = req.body
      const files = req.files || []

      // Validation
      if (!files.length) {
        console.log('❌ No files received')
        return res
          .status(400)
          .json({ success: false, error: 'File is required' })
      }

      const { statuses, users } = getCollections()

      // ═══════════════════════════════════════════════════════
      // 🔥 CHECK DAILY LIMIT (5 statuses per day)
      // ═══════════════════════════════════════════════════════
      const todayStart = new Date()
      todayStart.setHours(0, 0, 0, 0)

      const todayEnd = new Date()
      todayEnd.setHours(23, 59, 59, 999)

      const todayStatusCount = await statuses.countDocuments({
        userId: req.user.uid,
        createdAt: {
          $gte: todayStart,
          $lte: todayEnd,
        },
      })

      console.log(
        `📊 User has created ${todayStatusCount}/${MAX_STATUSES_PER_DAY} statuses today`
      )

      if (todayStatusCount >= MAX_STATUSES_PER_DAY) {
        console.log('❌ Daily status limit reached')
        return res.status(429).json({
          success: false,
          error: `Daily limit reached. You can only post ${MAX_STATUSES_PER_DAY} statuses per day.`,
          limit: MAX_STATUSES_PER_DAY,
          current: todayStatusCount,
        })
      }

      // Verify user exists
      console.log('Looking for user with firebaseUid:', req.user.uid)
      const user = await users.findOne({ firebaseUid: req.user.uid })

      if (!user) {
        console.log('❌ User not found in database')
        // Let's also check what users exist
        const allUsers = await users.find({}).limit(5).toArray()
        console.log(
          'Sample users in DB:',
          allUsers.map((u) => ({
            id: u._id,
            firebaseUid: u.firebaseUid,
            name: u.name,
          }))
        )

        return res.status(404).json({ success: false, error: 'User not found' })
      }

      console.log('✅ User found:', {
        id: user._id,
        name: user.name,
        firebaseUid: user.firebaseUid,
      })

      // Process file
      const file = files[0]
      const info = getFileInfo(file)
      const fullUrl = `${SERVER_BASE_URL}${info.url}`

      console.log('File info:', {
        type: info.type,
        url: info.url,
        fullUrl: fullUrl,
      })

      const newStatus = {
        userId: req.user.uid,
        userName: user.name || 'User',
        userAvatarColor: user.avatarColor || '#3498db',
        fileUrl: fullUrl,
        fileType: info.type,
        caption: caption?.trim() || '',
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      }

      console.log('Inserting status:', newStatus)
      const result = await statuses.insertOne(newStatus)

      const createdStatus = {
        ...newStatus,
        _id: result.insertedId,
      }

      console.log('✅ Status created:', createdStatus._id)
      res.json({
        success: true,
        status: createdStatus,
        dailyCount: todayStatusCount + 1,
        dailyLimit: MAX_STATUSES_PER_DAY,
      })
    } catch (err) {
      console.error('❌ Create status error:', err)
      console.error('Stack:', err.stack)
      res.status(500).json({
        success: false,
        error: 'Failed to create status',
        details: err.message,
      })
    }
  },
}

const getStatusesRoute = {
  path: '/statuses',
  method: 'get',
  middleware: [verifyAuthToken],
  handler: async (req, res) => {
    console.log('\n=== Get Statuses Request ===')
    console.log('User UID:', req.user?.uid)

    try {
      const { statuses } = getCollections()

      if (!statuses) {
        console.error('❌ Statuses collection not found!')
        return res.status(500).json({
          success: false,
          error: 'Database collection not initialized',
        })
      }

      const now = new Date()

      // Find all active statuses EXCEPT the current user's
      const allStatuses = await statuses
        .find({
          userId: { $ne: req.user.uid },
          expiresAt: { $gt: now },
        })
        .sort({ createdAt: -1 })
        .toArray()

      // Group statuses by user
      const groupedByUser = {}
      allStatuses.forEach((status) => {
        if (!groupedByUser[status.userId]) {
          groupedByUser[status.userId] = {
            userId: status.userId,
            userName: status.userName,
            userAvatarColor: status.userAvatarColor,
            statuses: [],
          }
        }
        groupedByUser[status.userId].statuses.push(status)
      })

      // Convert to array and add the first status data for preview
      const groupedStatuses = Object.values(groupedByUser).map((group) => ({
        _id: group.statuses[0]._id, // Use first status ID
        userId: group.userId,
        userName: group.userName,
        userAvatarColor: group.userAvatarColor,
        fileUrl: group.statuses[0].fileUrl, // Show first status as preview
        fileType: group.statuses[0].fileType,
        statusCount: group.statuses.length,
        statuses: group.statuses, // All statuses for this user
        createdAt: group.statuses[0].createdAt,
      }))

      console.log(
        `✅ Found ${allStatuses.length} statuses from ${groupedStatuses.length} users`
      )

      res.json({
        success: true,
        statuses: groupedStatuses,
      })
    } catch (err) {
      console.error('❌ Get statuses error:', err)
      res.status(500).json({
        success: false,
        error: 'Failed to fetch statuses',
        details: err.message,
      })
    }
  },
}

// DELETE status (owner only)
const deleteStatusRoute = {
  path: '/status/:id',
  method: 'delete',
  middleware: [verifyAuthToken],
  handler: async (req, res) => {
    console.log('\n=== Delete Status Request ===')
    console.log('Status ID:', req.params.id)
    console.log('User UID:', req.user?.uid)

    try {
      const { statuses } = getCollections()
      const { ObjectId } = require('mongodb')
      const statusId = req.params.id

      const status = await statuses.findOne({
        _id: new ObjectId(statusId),
        userId: req.user.uid,
      })

      if (!status) {
        console.log('❌ Status not found or not owner')
        return res
          .status(404)
          .json({ success: false, error: 'Status not found or not owner' })
      }

      await statuses.deleteOne({ _id: new ObjectId(statusId) })
      console.log('✅ Status deleted')
      res.json({ success: true })
    } catch (err) {
      console.error('❌ Delete status error:', err)
      console.error('Stack:', err.stack)
      res.status(500).json({
        success: false,
        error: 'Failed to delete',
        details: err.message,
      })
    }
  },
}

module.exports = { createStatusRoute, deleteStatusRoute, getStatusesRoute }
