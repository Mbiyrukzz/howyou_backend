const { getCollections } = require('../db')
const { ObjectId } = require('mongodb')

const userOwnChat = async (req, res, next) => {
  try {
    const currentUserId = req.user.uid

    // Get chatId from params or body
    const chatId = req.params.chatId || req.body.chatId

    console.log('🔍 userOwnChat middleware - checking access')
    console.log('  User ID:', currentUserId)
    console.log('  Chat ID:', chatId)

    if (!chatId) {
      console.error('❌ No chatId provided')
      return res.status(400).json({
        success: false,
        error: 'Chat ID is required',
      })
    }

    const { chats } = getCollections()

    // Build query - support both string IDs and ObjectIds
    let query = { participants: currentUserId }

    // Try to convert to ObjectId if it's a valid ObjectId string
    if (ObjectId.isValid(chatId)) {
      query._id = new ObjectId(chatId)
      console.log('  Using ObjectId format')
    } else {
      query._id = chatId
      console.log('  Using string ID format')
    }

    console.log('  Query:', JSON.stringify(query))

    const chat = await chats.findOne(query)

    if (!chat) {
      console.log(`❌ User ${currentUserId} not authorized for chat ${chatId}`)
      console.log('  Chat not found or user not a participant')
      return res.status(403).json({
        success: false,
        error: 'You do not have access to this chat',
      })
    }

    console.log(`✅ User ${currentUserId} authorized for chat ${chatId}`)
    console.log('  Chat participants:', chat.participants)

    // Attach chat to request for use in route handler
    req.chat = chat

    next()
  } catch (error) {
    console.error('❌ Error in userOwnChat middleware:', error.message)
    console.error('Stack:', error.stack)
    res.status(500).json({
      success: false,
      error: 'Failed to verify chat ownership',
      details: error.message,
    })
  }
}

module.exports = { userOwnChat }
