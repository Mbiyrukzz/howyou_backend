const ffmpeg = require('fluent-ffmpeg')
const path = require('path')
const fs = require('fs')

/**
 * Generate video thumbnail at 1 second mark
 */
const generateVideoThumbnail = (videoPath, outputPath) => {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .screenshots({
        timestamps: ['00:00:01'], // Capture at 1 second
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

module.exports = {
  generateVideoThumbnail,
  getVideoDuration,
  formatVideoDuration,
}
