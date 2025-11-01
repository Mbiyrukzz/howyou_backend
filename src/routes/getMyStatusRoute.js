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

      // Find ALL the user's active (non-expired) statuses
      const myStatuses = await statuses
        .find({
          userId: req.user.uid,
          expiresAt: { $gt: now },
        })
        .sort({ createdAt: -1 }) // Most recent first
        .toArray()

      if (!myStatuses || myStatuses.length === 0) {
        console.log('ℹ️ No active statuses found for this user.')
        return res.json({ success: true, statuses: [] })
      }

      console.log('✅ Found', myStatuses.length, 'active status(es) for user')

      res.json({
        success: true,
        statuses: myStatuses, // ← Return ALL your active statuses
      })
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
