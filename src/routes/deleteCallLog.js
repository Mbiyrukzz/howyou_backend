const { getCollections } = require('../db')
const { verifyAuthToken } = require('../middleware/verifyAuthToken')
const { ObjectId } = require('mongodb')

const deleteCallLogRoute = {
  path: '/delete-call/:callId',
  method: 'delete',
  middleware: [verifyAuthToken],
  handler: async (req, res) => {
    try {
      const { callId } = req.params
      const { calls } = getCollections()

      // Verify the call exists and user has access
      const call = await calls.findOne({
        _id: new ObjectId(callId),
        $or: [
          { callerId: req.user.uid },
          { recipientId: req.user.uid }
        ]
      })

      if (!call) {
        return res.status(404).json({
          success: false,
          error: 'Call log not found or access denied'
        })
      }

      // Delete the call log
      await calls.deleteOne({ _id: new ObjectId(callId) })

      res.json({
        success: true,
        message: 'Call log deleted successfully'
      })
    } catch (err) {
      console.error('❌ Error deleting call log:', err)
      res.status(500).json({
        success: false,
        error: 'Failed to delete call log',
        details: err.message
      })
    }
  }
}

module.exports = { deleteCallLogRoute }