const { getCollections } = require('../db')
const {
  uploadMultiple,
  getFileInfo,
} = require('../middleware/createUploadsDir')
const { verifyAuthToken } = require('../middleware/verifyAuthToken')
const { ObjectId } = require('mongodb')
const ffmpeg = require('fluent-ffmpeg')
const path = require('path')
const fs = require('fs')

const SERVER_BASE_URL = 'http://10.105.232.87:5000'

// =================== VIDEO HELPER FUNCTIONS ===================

/**
 * Generate video thumbnail at 1 second mark
 */
const generateVideoThumbnail = (videoPath, outputPath) => {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .screenshots({
        timestamps: ['00:00:03'], // Capture at 1 second
        filename: path.basename(outputPath),
        folder: path.dirname(outputPath),
        size: '640x360', // 16:9 aspect ratio
      })
      .on('end', () => {
        console.log('✅ Thumbnail generated:', outputPath)
        resolve(outputPath)
      })
      .on('error', (err) => {
        console.error('❌ Thumbnail generation failed:', err)
        reject(err)
      })
  })
}

/**
 * Get video duration in seconds
 */
const getVideoDuration = (videoPath) => {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) {
        console.error('❌ Error getting video duration:', err)
        reject(err)
      } else {
        const duration = metadata.format.duration
        resolve(Math.floor(duration))
      }
    })
  })
}

/**
 * Format duration from seconds to MM:SS or HH:MM:SS
 */
const formatVideoDuration = (seconds) => {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = seconds % 60

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs
      .toString()
      .padStart(2, '0')}`
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`
}

// =================== AUDIO/VIDEO CONVERSION FUNCTIONS ===================

/**
 * Convert audio files to MP3 for universal compatibility
 */
const convertAudioToMp3 = (inputPath, outputPath) => {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .toFormat('mp3')
      .audioBitrate('128k')
      .audioCodec('libmp3lame')
      .audioChannels(2) // Stereo for better compatibility
      .audioFrequency(44100) // Standard sample rate
      .on('start', (cmd) => {
        console.log('🎵 Starting audio conversion:', cmd)
      })
      .on('end', () => {
        console.log('✅ Audio conversion completed:', outputPath)
        resolve(outputPath)
      })
      .on('error', (err) => {
        console.error('❌ Audio conversion failed:', err)
        reject(err)
      })
      .save(outputPath)
  })
}

/**
 * Convert video to web-compatible format
 */
const convertVideoToWebFormat = (inputPath, outputPath) => {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .videoCodec('libx264') // H.264 codec - universal support
      .audioCodec('aac') // AAC audio - universal support
      .format('mp4')
      .outputOptions([
        '-preset fast', // Fast encoding
        '-crf 23', // Quality (lower = better, 23 is default)
        '-movflags +faststart', // Enable streaming
        '-pix_fmt yuv420p', // Ensure compatibility
      ])
      .on('start', (cmd) => {
        console.log('🎬 Starting video conversion:', cmd)
      })
      .on('progress', (progress) => {
        console.log(`🎬 Processing: ${progress.percent}% done`)
      })
      .on('end', () => {
        console.log('✅ Video conversion completed:', outputPath)
        resolve(outputPath)
      })
      .on('error', (err) => {
        console.error('❌ Video conversion failed:', err)
        reject(err)
      })
      .save(outputPath)
  })
}

// =================== MAIN ROUTE ===================

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
        for (const file of files) {
          let info = getFileInfo(file)
          let originalPath = file.path

          try {
            // ✅ AUDIO PROCESSING
            if (info.type === 'audio') {
              console.log('🔄 Converting audio to MP3:', {
                original: file.filename,
                mimetype: file.mimetype,
              })

              const inputPath = file.path
              const mp3Filename = file.filename.replace(/\.[^.]+$/, '.mp3')
              const mp3Path = path.join(path.dirname(inputPath), mp3Filename)

              await convertAudioToMp3(inputPath, mp3Path)

              // Delete original file
              if (fs.existsSync(inputPath)) {
                fs.unlinkSync(inputPath)
                console.log('🗑️ Deleted original audio file:', file.filename)
              }

              // Update file info with converted file
              const stats = fs.statSync(mp3Path)
              info = {
                filename: mp3Filename,
                originalName: info.originalName.replace(/\.[^.]+$/, '.mp3'),
                mimetype: 'audio/mpeg',
                size: stats.size,
                type: 'audio',
                url: `/uploads/audio/${mp3Filename}`,
              }

              console.log('✅ Audio converted successfully:', {
                newFile: mp3Filename,
                size: stats.size,
              })
            }
            // ✅ VIDEO PROCESSING WITH THUMBNAIL
            else if (info.type === 'video') {
              console.log('🔄 Converting video to web format:', {
                original: file.filename,
                mimetype: file.mimetype,
              })

              const inputPath = file.path
              const mp4Filename = file.filename.replace(/\.[^.]+$/, '.mp4')
              const mp4Path = path.join(path.dirname(inputPath), mp4Filename)

              // Generate thumbnail filename and path
              const thumbnailFilename = mp4Filename.replace(
                '.mp4',
                '_thumb.jpg'
              )
              const thumbnailDir = path.join('uploads', 'thumbnails')
              const thumbnailPath = path.join(thumbnailDir, thumbnailFilename)

              // Ensure thumbnails directory exists
              if (!fs.existsSync(thumbnailDir)) {
                fs.mkdirSync(thumbnailDir, { recursive: true })
                console.log('📁 Created thumbnails directory')
              }

              try {
                // Step 1: Convert video to web format
                await convertVideoToWebFormat(inputPath, mp4Path)

                // Step 2: Generate thumbnail
                await generateVideoThumbnail(mp4Path, thumbnailPath)

                // Step 3: Get video duration
                const durationSeconds = await getVideoDuration(mp4Path)
                const formattedDuration = formatVideoDuration(durationSeconds)

                // Step 4: Delete original file
                if (fs.existsSync(inputPath)) {
                  fs.unlinkSync(inputPath)
                  console.log('🗑️ Deleted original video file:', file.filename)
                }

                // Step 5: Update file info with all metadata
                const stats = fs.statSync(mp4Path)
                info = {
                  filename: mp4Filename,
                  originalName: info.originalName.replace(/\.[^.]+$/, '.mp4'),
                  mimetype: 'video/mp4',
                  size: stats.size,
                  type: 'video',
                  url: `/uploads/videos/${mp4Filename}`,
                  thumbnailUrl: `/uploads/thumbnails/${thumbnailFilename}`,
                  duration: formattedDuration,
                  durationSeconds: durationSeconds,
                }

                console.log('✅ Video processed successfully:', {
                  newFile: mp4Filename,
                  thumbnail: thumbnailFilename,
                  duration: formattedDuration,
                  size: stats.size,
                })
              } catch (videoProcessingError) {
                console.error(
                  '⚠️ Video processing failed:',
                  videoProcessingError.message
                )
                // If thumbnail generation fails, continue without it
                const stats = fs.existsSync(mp4Path)
                  ? fs.statSync(mp4Path)
                  : fs.statSync(inputPath)

                info = {
                  filename: fs.existsSync(mp4Path)
                    ? mp4Filename
                    : file.filename,
                  originalName: info.originalName,
                  mimetype: fs.existsSync(mp4Path)
                    ? 'video/mp4'
                    : file.mimetype,
                  size: stats.size,
                  type: 'video',
                  url: fs.existsSync(mp4Path)
                    ? `/uploads/videos/${mp4Filename}`
                    : `/uploads/videos/${file.filename}`,
                  thumbnailUrl: null,
                  duration: '0:00',
                  durationSeconds: 0,
                }
              }
            }
          } catch (conversionError) {
            console.error(
              `⚠️ ${info.type} conversion failed, using original:`,
              conversionError.message
            )
            // Continue with original file if conversion fails
          }

          // Build full URLs
          const fullUrl = `${SERVER_BASE_URL}${info.url}`
          const thumbnailFullUrl = info.thumbnailUrl
            ? `${SERVER_BASE_URL}${info.thumbnailUrl}`
            : null

          console.log('File processed:', {
            originalName: info.originalName,
            type: info.type,
            mimetype: info.mimetype,
            url: fullUrl,
            thumbnailUrl: thumbnailFullUrl,
            duration: info.duration,
          })

          fileInfoArray.push({
            url: fullUrl,
            thumbnailUrl: thumbnailFullUrl,
            originalname: info.originalName,
            filename: info.filename,
            mimetype: info.mimetype,
            size: info.size,
            type: info.type,
            duration: info.duration,
            durationSeconds: info.durationSeconds,
          })
        }
      }

      // Determine message type
      let finalMessageType = 'text'
      if (hasFiles) {
        if (messageType && messageType !== 'text') {
          finalMessageType = messageType
        } else {
          const firstFileType = fileInfoArray[0].type
          finalMessageType = firstFileType
        }
      }

      const newMessage = {
        chatId: new ObjectId(chatId),
        senderId: req.user.uid,
        content: hasContent ? content.trim() : '',
        type: finalMessageType,
        status: 'sent',
        sentAt: new Date(),
        deliveredBy: [],
        readBy: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      }

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
        const typeEmoji = {
          audio: '🎵',
          video: '🎬',
          image: '📷',
          file: '📎',
        }
        lastMessagePreview = `${typeEmoji[finalMessageType] || '📎'} ${
          finalMessageType.charAt(0).toUpperCase() + finalMessageType.slice(1)
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
