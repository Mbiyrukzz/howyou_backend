// sendMessageRoute.js - FIXED with correct URLs
const { getCollections } = require('../db')
const {
  uploadMultiple,
  getFileInfo,
} = require('../middleware/createUploadsDir')
const { verifyAuthToken } = require('../middleware/verifyAuthToken')
const { ObjectId } = require('mongodb')

// IMPORTANT: Update this to match your actual server URL
// For local development, use your machine's IP address
const SERVER_BASE_URL = process.env.SERVER_BASE_URL || 'http://localhost:5000'

const sendMessageRoute = {
  path: '/send-message',
  method: 'post',
  middleware: [verifyAuthToken, uploadMultiple('files', 5)],
  handler: async (req, res) => {
    console.log('=== Send Message Request ===')
    console.log('Body:', req.body)
    console.log('Files received:', req.files?.length || 0)
    if (req.files?.length > 0) {
      console.log('First file details:', {
        filename: req.files[0].filename,
        mimetype: req.files[0].mimetype,
        size: req.files[0].size,
        path: req.files[0].path,
      })
    }

    try {
      const { chatId, content, messageType } = req.body
      const files = req.files || []

      // Validation
      if (!chatId) {
        return res.status(400).json({
          success: false,
          error: 'chatId is required',
        })
      }

      // Check if message has content or files
      const hasContent = content && content.trim().length > 0
      const hasFiles = files.length > 0

      if (!hasContent && !hasFiles) {
        return res.status(400).json({
          success: false,
          error: 'Message must have content or files',
        })
      }

      const { messages, chats } = getCollections()

      // Verify user has access to this chat
      const chat = await chats.findOne({
        _id: new ObjectId(chatId),
        participants: req.user.uid,
      })

      if (!chat) {
        return res.status(403).json({
          success: false,
          error: 'Access denied to this chat',
        })
      }

      // Process uploaded files
      let fileInfoArray = []
      if (hasFiles) {
        fileInfoArray = files.map((file) => {
          const info = getFileInfo(file)
          // Construct the full URL
          const fullUrl = `${SERVER_BASE_URL}${info.url}`

          console.log('File info generated:', {
            originalName: info.originalName,
            filename: info.filename,
            url: fullUrl,
          })

          return {
            url: fullUrl,
            originalname: info.originalName,
            filename: info.filename,
            mimetype: info.mimetype,
            size: info.size,
            type: info.type,
          }
        })
        console.log('Processed files:', fileInfoArray)
      }

      // Determine message type
      let finalMessageType = 'text'
      if (hasFiles) {
        if (messageType && messageType !== 'text') {
          finalMessageType = messageType
        } else {
          // Auto-detect from first file
          const firstFileType = fileInfoArray[0].type
          finalMessageType = firstFileType
        }
      }

      // Create message document
      const newMessage = {
        chatId: new ObjectId(chatId),
        senderId: req.user.uid,
        content: hasContent ? content.trim() : '',
        type: finalMessageType,
        createdAt: new Date(),
      }

      // Only add files array if there are files
      if (fileInfoArray.length > 0) {
        newMessage.files = fileInfoArray
      }

      console.log('Creating message:', {
        ...newMessage,
        files: newMessage.files?.map((f) => ({ url: f.url, type: f.type })),
      })

      const result = await messages.insertOne(newMessage)

      // Update chat's lastMessage and lastActivity
      let lastMessagePreview = ''
      if (hasContent) {
        lastMessagePreview = content.trim().substring(0, 50)
      } else if (hasFiles) {
        lastMessagePreview = `Sent ${files.length} ${finalMessageType}${
          files.length > 1 ? 's' : ''
        }`
      }

      await chats.updateOne(
        { _id: new ObjectId(chatId) },
        {
          $set: {
            lastMessage: lastMessagePreview,
            lastActivity: new Date(),
          },
        }
      )

      const createdMessage = {
        ...newMessage,
        _id: result.insertedId,
      }

      console.log('✅ Message created successfully with ID:', result.insertedId)
      console.log(
        'File URLs in response:',
        createdMessage.files?.map((f) => f.url)
      )

      res.json({
        success: true,
        message: createdMessage,
      })
    } catch (err) {
      console.error('❌ Error saving message:', err)
      res.status(500).json({
        success: false,
        error: 'Failed to send message',
        details: err.message,
      })
    }
  },
}

module.exports = { sendMessageRoute }
