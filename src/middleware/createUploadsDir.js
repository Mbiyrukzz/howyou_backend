const multer = require('multer')
const path = require('path')
const fs = require('fs')

const createUploadDirs = () => {
  // Use absolute path based on the current file's location
  const baseDir = path.join(__dirname, '..') // Goes up to 'src' folder
  const dirs = [
    path.join(baseDir, 'uploads'),
    path.join(baseDir, 'uploads', 'images'),
    path.join(baseDir, 'uploads', 'videos'),
    path.join(baseDir, 'uploads', 'files'),
    path.join(baseDir, 'uploads', 'audio'),
  ]

  dirs.forEach((dir) => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
      console.log('✅ Created directory:', dir)
    }
  })
}

createUploadDirs()

// Configure storage with absolute paths
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const baseDir = path.join(__dirname, '..') // 'src' folder
    let uploadPath = path.join(baseDir, 'uploads')

    // Determine upload path based on file type
    if (file.mimetype.startsWith('image/')) {
      uploadPath = path.join(uploadPath, 'images')
    } else if (file.mimetype.startsWith('video/')) {
      uploadPath = path.join(uploadPath, 'videos')
    } else if (file.mimetype.startsWith('audio/')) {
      uploadPath = path.join(uploadPath, 'audio')
    } else {
      uploadPath = path.join(uploadPath, 'files')
    }

    cb(null, uploadPath)
  },
  filename: (req, file, cb) => {
    // Generate unique filename: timestamp-random-originalname
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9)
    const ext = path.extname(file.originalname)
    const nameWithoutExt = path.basename(file.originalname, ext)
    cb(null, `${uniqueSuffix}-${nameWithoutExt}${ext}`)
  },
})

const fileFilter = (req, file, cb) => {
  // Allowed file types
  const allowedTypes = {
    image: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
    video: ['video/mp4', 'video/mpeg', 'video/quicktime', 'video/webm'],
    audio: [
      'audio/mpeg',
      'audio/wav',
      'audio/ogg',
      'audio/mp4',
      'audio/m4a',
      'audio/x-m4a',
      'audio/mp4a-latm',
      'audio/aac',
      'audio/mp3',
      'audio/webm',
    ],
    document: [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/plain',
    ],
  }

  const allAllowedTypes = [
    ...allowedTypes.image,
    ...allowedTypes.video,
    ...allowedTypes.audio,
    ...allowedTypes.document,
  ]

  if (allAllowedTypes.includes(file.mimetype)) {
    cb(null, true)
  } else {
    console.log('❌ Rejected file type:', file.mimetype) // ← Add this for debugging
    cb(new Error(`File type ${file.mimetype} is not allowed`), false)
  }
}
// Create multer instance
const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
    files: 5, // Maximum 5 files per request
  },
})

// Middleware functions
const uploadSingle = (fieldName = 'file') => {
  return (req, res, next) => {
    upload.single(fieldName)(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({
            success: false,
            error: 'File too large. Maximum size is 50MB',
          })
        }
        if (err.code === 'LIMIT_FILE_COUNT') {
          return res.status(400).json({
            success: false,
            error: 'Too many files. Maximum is 5 files',
          })
        }
        return res.status(400).json({
          success: false,
          error: `Upload error: ${err.message}`,
        })
      } else if (err) {
        return res.status(400).json({
          success: false,
          error: err.message,
        })
      }
      next()
    })
  }
}

const uploadMultiple = (fieldName = 'files', maxCount = 5) => {
  return (req, res, next) => {
    upload.array(fieldName, maxCount)(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({
            success: false,
            error: 'File too large. Maximum size is 50MB',
          })
        }
        if (err.code === 'LIMIT_FILE_COUNT') {
          return res.status(400).json({
            success: false,
            error: `Too many files. Maximum is ${maxCount} files`,
          })
        }
        return res.status(400).json({
          success: false,
          error: `Upload error: ${err.message}`,
        })
      } else if (err) {
        return res.status(400).json({
          success: false,
          error: err.message,
        })
      }
      next()
    })
  }
}

// Helper function to get file type from mimetype
const getFileType = (mimetype) => {
  if (mimetype.startsWith('image/')) return 'image'
  if (mimetype.startsWith('video/')) return 'video'
  if (mimetype.startsWith('audio/')) return 'audio'
  return 'file'
}

// Helper function to get file info
const getFileInfo = (file) => {
  const fileType = getFileType(file.mimetype)
  let folderName = 'files' // default

  if (fileType === 'image') folderName = 'images'
  else if (fileType === 'video') folderName = 'videos'
  else if (fileType === 'audio') folderName = 'audio'

  return {
    originalName: file.originalname,
    filename: file.filename,
    mimetype: file.mimetype,
    size: file.size,
    path: file.path,
    type: fileType,
    url: `/uploads/${folderName}/${file.filename}`,
  }
}
module.exports = {
  uploadSingle,
  uploadMultiple,
  getFileInfo,
  getFileType,
}
