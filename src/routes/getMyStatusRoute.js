// routes/getMyStatusRoute.js
const { getCollections } = require('../db')
const { verifyAuthToken } = require('../middleware/verifyAuthToken')

const getMyStatusRoute = {
  path: '/status/my',
  method: 'get',
  middleware: [verifyAuthToken],
  handler: async (req, res) => {
    console.log('\n=== Get My Status Request ===')
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

      // Find the user’s active (non-expired) status
      const myStatus = await statuses.findOne({
        userId: req.user.uid,
        expiresAt: { $gt: now },
      })

      if (!myStatus) {
        console.log('ℹ️ No active status found for this user.')
        return res.json({ success: true, status: null })
      }

      console.log('✅ Found active status for user:', {
        id: myStatus._id,
        createdAt: myStatus.createdAt,
        expiresAt: myStatus.expiresAt,
      })

      res.json({ success: true, status: myStatus })
    } catch (err) {
      console.error('❌ Get my status error:', err)
      res.status(500).json({
        success: false,
        error: 'Failed to fetch user status',
        details: err.message,
      })
    }
  },
}

module.exports = { getMyStatusRoute }
