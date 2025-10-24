const { getCollections } = require('../db')
const { ObjectId } = require('mongodb')

const userOwnMessage = async (req, res, next) => {
  try {
    const currentUserId = req.user.uid

    // Get messageId from params or body
    const messageId = req.params.messageId || req.body.messageId

    console.log('🔍 userOwnMessage middleware - checking access')
    console.log('  User ID:', currentUserId)
    console.log('  Message ID:', messageId)

    if (!messageId) {
      console.error('❌ No messageId provided')
      return res.status(400).json({
        success: false,
        error: 'Message ID is required',
      })
    }

    const { messages } = getCollections()

    // Build query - support both string IDs and ObjectIds
    let query = { senderId: currentUserId }

    // Try to convert to ObjectId if it's a valid ObjectId string
    if (ObjectId.isValid(messageId)) {
      query._id = new ObjectId(messageId)
      console.log('  Using ObjectId format')
    } else {
      query._id = messageId
      console.log('  Using string ID format')
    }

    console.log('  Query:', JSON.stringify(query))

    const message = await messages.findOne(query)

    if (!message) {
      console.log(
        `❌ User ${currentUserId} not authorized for message ${messageId}`
      )
      console.log('  Message not found or user is not the sender')
      return res.status(403).json({
        success: false,
        error: 'You do not have permission to modify this message',
      })
    }

    console.log(`✅ User ${currentUserId} authorized for message ${messageId}`)
    console.log('  Message sender:', message.senderId)

    // Attach message to request for use in route handler
    req.message = message

    next()
  } catch (error) {
    console.error('❌ Error in userOwnMessage middleware:', error.message)
    console.error('Stack:', error.stack)
    res.status(500).json({
      success: false,
      error: 'Failed to verify message ownership',
      details: error.message,
    })
  }
}

module.exports = { userOwnMessage }
