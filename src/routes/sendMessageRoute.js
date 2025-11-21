const { getCollections } = require('../db')
const {
  uploadMultiple,
  getFileInfo,
} = require('../middleware/createUploadsDir')
const { verifyAuthToken } = require('../middleware/verifyAuthToken')
const { ObjectId } = require('mongodb')

const SERVER_BASE_URL = process.env.SERVER_BASE_URL || 'http://10.219.2.87:5000'

const sendMessageRoute = {
  path: '/send-message',
  method: 'post',
  middleware: [verifyAuthToken, uploadMultiple('files', 5)],
  handler: async (req, res) => {
    console.log('=== Send Message Request ===')
    console.log('Body:', req.body)
    console.log('Files received:', req.files?.length || 0)

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

      // ✅ FIX: Allow empty content if files are present
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
          const fullUrl = `${SERVER_BASE_URL}${info.url}`

          console.log('File processed:', {
            originalName: info.originalName,
            type: info.type,
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

      // ✅ Create the message object with status fields
      const newMessage = {
        chatId: new ObjectId(chatId),
        senderId: req.user.uid,
        content: hasContent ? content.trim() : '', // ✅ Allow empty content
        type: finalMessageType,
        status: 'sent',
        sentAt: new Date(),
        deliveredBy: [],
        readBy: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      // Only add files array if there are files
      if (fileInfoArray.length > 0) {
        newMessage.files = fileInfoArray
      }

      console.log('Creating message:', {
        type: newMessage.type,
        hasContent: !!newMessage.content,
        filesCount: newMessage.files?.length || 0,
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

      console.log('✅ Message created successfully:', result.insertedId)

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
