// backend/routes/createUserRoute.js
const { getCollections } = require('../db')

const createUserRoute = {
  method: 'post',
  path: '/users',
  handler: async (req, res) => {
    try {
      const { users } = getCollections()
      const { userId } = req.params

      console.log('📥 Update profile picture request')
      console.log('📥 URL params userId:', userId)
      console.log('📥 req.user.uid:', req.user?.uid)
      console.log('📥 req.file:', req.file ? 'File received' : 'No file')

      // Security check
      if (req.user.uid !== userId) {
        console.log('❌ Security check failed')
        return res.status(403).json({
          success: false,
          error: 'You can only update your own profile picture',
        })
      }
      console.log('✅ Security check passed')

      if (!req.file) {
        console.error('❌ No file in request')
        return res.status(400).json({
          success: false,
          error: 'No profile picture file provided',
        })
      }
      console.log('✅ File check passed')

      // Get file info
      const fileInfo = getFileInfo(req.file)
      console.log('📸 File info:', fileInfo)

      // Verify it's an image
      if (!fileInfo.mimetype.startsWith('image/')) {
        console.log('❌ File type check failed')
        return res.status(400).json({
          success: false,
          error: 'Only image files are allowed for profile pictures',
        })
      }
      console.log('✅ File type check passed')

      // Find user first to verify existence
      console.log('🔍 Looking up user with firebaseUid:', userId)
      const user = await users.findOne({ firebaseUid: userId })
      console.log('🔍 User lookup result:', user ? 'Found' : 'NOT FOUND')

      if (!user) {
        console.log('❌ User not found in database')
        return res.status(404).json({
          success: false,
          error: 'User not found',
        })
      }
      console.log('✅ User found:', user.email)

      // Update user's profile picture in MongoDB
      console.log('💾 Updating user in database...')

      // ✅ FIX: Use updateOne instead of findOneAndUpdate, then fetch the updated user
      const updateResult = await users.updateOne(
        { firebaseUid: userId },
        {
          $set: {
            profilePicture: fileInfo.url,
            profilePictureFilename: fileInfo.filename,
            updatedAt: new Date(),
          },
        }
      )

      console.log('💾 Update result:', {
        matched: updateResult.matchedCount,
        modified: updateResult.modifiedCount,
      })

      if (updateResult.matchedCount === 0) {
        console.log('❌ No user matched for update')
        return res.status(404).json({
          success: false,
          error: 'User not found',
        })
      }

      // Fetch the updated user
      const updatedUser = await users.findOne({ firebaseUid: userId })
      console.log('✅ Database updated successfully')

      // Also update Firebase Auth photoURL
      try {
        const admin = require('firebase-admin')
        const fullUrl = `${req.protocol}://${req.get('host')}${fileInfo.url}`
        console.log('🔥 Updating Firebase Auth photoURL:', fullUrl)

        await admin.auth().updateUser(userId, {
          photoURL: fullUrl,
        })
        console.log('✅ Firebase Auth photoURL updated')
      } catch (firebaseError) {
        console.warn(
          '⚠️ Firebase photoURL update failed:',
          firebaseError.message
        )
        // Don't fail the request if Firebase update fails
      }

      console.log('✅ Profile picture updated successfully for user:', userId)
      console.log('📤 Sending success response...')

      res.json({
        success: true,
        user: updatedUser,
        profilePicture: fileInfo.url,
        message: 'Profile picture updated successfully',
      })

      console.log('✅ Response sent successfully')
    } catch (err) {
      console.error('❌ Error updating profile picture:', err)
      console.error('Error stack:', err.stack)
      res.status(500).json({
        success: false,
        error: 'Failed to update profile picture',
        details: err.message,
      })
    }
  },
}

module.exports = { createUserRoute }
