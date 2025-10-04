// sendMessageRoute.js - WITH FILE UPLOAD SUPPORT
const { getCollections } = require('../db')
const {
  uploadMultiple,
  getFileInfo,
  uploadSingle,
} = require('../middleware/createUploadsDir')
const { verifyAuthToken } = require('../middleware/verifyAuthToken')

const { ObjectId } = require('mongodb')

const sendMessageRoute = {
  path: '/send-message',
  method: 'post',
  middleware: [
    verifyAuthToken,
    uploadMultiple('files', 5),
   
  ],
  handler: async (req, res) => {
    console.log('Request body:', req.body)
    console.log('Request files:', req.files)
    console.log('User:', req.user)
    try {
      const { chatId, content, messageType } = req.body
      const files = req.files || []

      // Validation
      if (!chatId) {
        return res
          .status(400)
          .json({ success: false, error: 'chatId is required' })
      }

      if (!content?.trim() && files.length === 0) {
        return res
          .status(400)
          .json({ success: false, error: 'Message must have content or files' })
      }

      const { messages, chats } = getCollections()

      // Verify user has access to this chat
      const chat = await chats.findOne({
        _id: new ObjectId(chatId),
        participants: req.user.uid,
      })

      if (!chat) {
        return res
          .status(403)
          .json({ success: false, error: 'Access denied to this chat' })
      }

      // Process uploaded files
      const fileInfoArray = files.map((file) => {
        const info = getFileInfo(file)
        return {
          url: `http://10.143.145.87:5000${info.url}`,
          originalname: info.originalName,
          filename: info.filename,
          mimetype: info.mimetype,
          size: info.size,
          type: info.type,
        }
      })

      // Determine message type
      let finalMessageType = 'text'
      if (files.length > 0) {
        if (messageType) {
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
        content: content?.trim() || '',
        type: finalMessageType,
        files: fileInfoArray.length > 0 ? fileInfoArray : undefined,
        createdAt: new Date(),
      }

      const result = await messages.insertOne(newMessage)

      // Update chat's lastMessage and lastActivity
      const lastMessagePreview = content?.trim()
        ? content.trim().substring(0, 50)
        : files.length > 0
        ? `Sent ${files.length} file(s)`
        : 'New message'

      await chats.updateOne(
        { _id: new ObjectId(chatId) },
        {
          $set: {
            lastMessage: lastMessagePreview,
            lastActivity: new Date(),
          },
        }
      )

      res.json({
        success: true,
        message: { ...newMessage, _id: result.insertedId },
      })
    } catch (err) {
      console.error('Error saving message:', err)
      res.status(500).json({
        success: false,
        error: 'Failed to send message',
        details: err.message,
      })
    }
  },
}

module.exports = { sendMessageRoute }
