// fileUploadRoute.js - Dedicated route for file uploads
const { verifyAuthToken } = require('../middleware/verifyAuthToken')
const {
  uploadMultiple,
  getFileInfo,
} = require('../middleware/uploadMiddleware')

const fileUploadRoute = {
  path: '/upload-files',
  method: 'post',
  middleware: [verifyAuthToken, uploadMultiple('files', 10)],
  handler: async (req, res) => {
    try {
      const files = req.files || []

      if (files.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'No files uploaded',
        })
      }

      // Process files and return file information
      const processedFiles = files.map((file) => getFileInfo(file))

      res.json({
        success: true,
        files: processedFiles,
        message: `Successfully uploaded ${files.length} file(s)`,
      })
    } catch (err) {
      console.error('❌ Error uploading files:', err)
      res.status(500).json({
        success: false,
        error: 'Failed to upload files',
      })
    }
  },
}

module.exports = { fileUploadRoute }
