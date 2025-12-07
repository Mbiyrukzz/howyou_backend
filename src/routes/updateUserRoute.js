// routes/user-profile.js
const { getCollections } = require('../db')
const { uploadSingle, getFileInfo } = require('../middleware/createUploadsDir')
const { verifyAuthToken } = require('../middleware/verifyAuthToken')
const admin = require('firebase-admin')

// ✅ Add SERVER_BASE_URL constant (same as sendMessageRoute)
const SERVER_BASE_URL = 'http://10.105.232.87:5000'

// ==============================
// GET USER PROFILE
// ==============================
const getUserProfileRoute = {
  method: 'get',
  path: '/users/:userId/profile',
  middleware: [verifyAuthToken],
  handler: async (req, res) => {
    try {
      const { users } = getCollections()
      const { userId } = req.params

      // Security check
      if (req.user.uid !== userId) {
        return res.status(403).json({
          success: false,
          error: 'You can only view your own profile',
        })
      }

      const user = await users.findOne({ firebaseUid: userId })

      if (!user) {
        return res.status(404).json({
          success: false,
          error: 'User not found',
        })
      }

      // Remove sensitive fields
      const { _id, ...userProfile } = user

      // ✅ Convert profilePicture to full URL if it exists
      if (userProfile.profilePicture) {
        userProfile.profilePicture = `${SERVER_BASE_URL}${userProfile.profilePicture}`
      }

      res.json({
        success: true,
        user: {
          ...userProfile,
          id: _id.toString(),
        },
      })
    } catch (err) {
      console.error('❌ Error getting user profile:', err)
      res.status(500).json({
        success: false,
        error: 'Failed to get user profile',
        details: err.message,
      })
    }
  },
}

// ==============================
// UPDATE USER PROFILE
// ==============================
const updateUserProfileRoute = {
  method: 'put',
  path: '/users/:userId/profile',
  middleware: [verifyAuthToken],
  handler: async (req, res) => {
    try {
      const { name, email } = req.body
      const { userId } = req.params
      const { users } = getCollections()

      // Security check
      if (req.user.uid !== userId) {
        return res.status(403).json({
          success: false,
          error: 'You can only update your own profile',
        })
      }

      if (!name && !email) {
        return res.status(400).json({
          success: false,
          error: 'At least one field (name or email) is required',
        })
      }

      const updateData = {}
      if (name) updateData.name = name.trim()
      if (email) updateData.email = email.trim().toLowerCase()
      updateData.updatedAt = new Date()

      // If email is being updated, also update it in Firebase Auth
      if (email) {
        try {
          await admin.auth().updateUser(userId, {
            email: email.trim().toLowerCase(),
          })
          console.log('✅ Firebase Auth email updated for user:', userId)
        } catch (firebaseError) {
          console.error('❌ Firebase email update failed:', firebaseError)
          return res.status(400).json({
            success: false,
            error:
              firebaseError.message || 'Failed to update email in Firebase',
          })
        }
      }

      // Update in MongoDB
      const result = await users.findOneAndUpdate(
        { firebaseUid: userId },
        { $set: updateData },
        { returnDocument: 'after' }
      )

      if (!result.value) {
        return res.status(404).json({
          success: false,
          error: 'User not found',
        })
      }

      console.log('✅ User profile updated:', userId)

      // ✅ Convert profilePicture to full URL if it exists
      const updatedUser = { ...result.value }
      if (updatedUser.profilePicture) {
        updatedUser.profilePicture = `${SERVER_BASE_URL}${updatedUser.profilePicture}`
      }

      res.json({
        success: true,
        user: updatedUser,
        message: 'Profile updated successfully',
      })
    } catch (err) {
      console.error('❌ Error updating user profile:', err)
      res.status(500).json({
        success: false,
        error: 'Failed to update profile',
        details: err.message,
      })
    }
  },
}

// ==============================
// UPDATE PROFILE PICTURE
// ==============================
const updateProfilePictureRoute = {
  method: 'put',
  path: '/users/:userId/profile-picture',
  middleware: [verifyAuthToken, uploadSingle('file')],
  handler: async (req, res) => {
    try {
      const { users } = getCollections()
      const { userId } = req.params

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

      const updateResult = await users.updateOne(
        { firebaseUid: userId },
        {
          $set: {
            profilePicture: fileInfo.url, // Store relative URL in DB
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

      // ✅ Build full URL (same pattern as sendMessageRoute)
      const fullUrl = `${SERVER_BASE_URL}${fileInfo.url}`
      console.log('🖼️ Full profile picture URL:', fullUrl)

      // Also update Firebase Auth photoURL
      try {
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

      // ✅ Return full URL to frontend (same pattern as sendMessageRoute)
      res.json({
        success: true,
        user: {
          ...updatedUser,
          profilePicture: fullUrl, // Send full URL to frontend
        },
        profilePicture: fullUrl,
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

// ==============================
// UPDATE PASSWORD
// ==============================
const updatePasswordRoute = {
  method: 'put',
  path: '/users/:userId/password',
  middleware: [verifyAuthToken],
  handler: async (req, res) => {
    try {
      const { currentPassword, newPassword } = req.body
      const { userId } = req.params

      // Security check
      if (req.user.uid !== userId) {
        return res.status(403).json({
          success: false,
          error: 'You can only change your own password',
        })
      }

      if (!currentPassword || !newPassword) {
        return res.status(400).json({
          success: false,
          error: 'Both currentPassword and newPassword are required',
        })
      }

      if (newPassword.length < 6) {
        return res.status(400).json({
          success: false,
          error: 'New password must be at least 6 characters long',
        })
      }

      // Get user's email from Firebase
      const userRecord = await admin.auth().getUser(userId)
      const email = userRecord.email

      if (!email) {
        return res.status(400).json({
          success: false,
          error: 'User email not found',
        })
      }

      // Verify current password
      const verifyPasswordUrl = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${process.env.FIREBASE_API_KEY}`

      try {
        const verifyResponse = await fetch(verifyPasswordUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: email,
            password: currentPassword,
            returnSecureToken: true,
          }),
        })

        if (!verifyResponse.ok) {
          return res.status(401).json({
            success: false,
            error: 'Current password is incorrect',
          })
        }
      } catch (verifyError) {
        console.error('❌ Password verification failed:', verifyError)
        return res.status(401).json({
          success: false,
          error: 'Current password is incorrect',
        })
      }

      // Update password in Firebase Auth
      await admin.auth().updateUser(userId, {
        password: newPassword,
      })

      // Revoke refresh tokens to log out all sessions except current
      await admin.auth().revokeRefreshTokens(userId)

      // Update lastPasswordChange in MongoDB
      const { users } = getCollections()
      await users.updateOne(
        { firebaseUid: userId },
        {
          $set: {
            lastPasswordChange: new Date(),
            updatedAt: new Date(),
          },
        }
      )

      console.log('✅ Password updated successfully for user:', userId)

      res.json({
        success: true,
        message: 'Password updated successfully. You may need to log in again.',
        requiresReauth: true,
      })
    } catch (err) {
      console.error('❌ Error updating password:', err)

      if (err.code === 'auth/user-not-found') {
        return res.status(404).json({
          success: false,
          error: 'User not found',
        })
      }

      res.status(500).json({
        success: false,
        error: 'Failed to update password',
        details: err.message,
      })
    }
  },
}

// ==============================
// DELETE PROFILE PICTURE
// ==============================
const deleteProfilePictureRoute = {
  method: 'delete',
  path: '/users/:userId/profile-picture',
  middleware: [verifyAuthToken],
  handler: async (req, res) => {
    try {
      const { users } = getCollections()
      const { userId } = req.params
      const fs = require('fs')
      const path = require('path')

      // Security check
      if (req.user.uid !== userId) {
        return res.status(403).json({
          success: false,
          error: 'You can only delete your own profile picture',
        })
      }

      // Get user to find current profile picture
      const user = await users.findOne({ firebaseUid: userId })

      if (!user) {
        return res.status(404).json({
          success: false,
          error: 'User not found',
        })
      }

      // Delete file from disk if it exists
      if (user.profilePictureFilename) {
        const filePath = path.join(
          __dirname,
          '..',
          'uploads',
          'images', // ✅ Add 'images' folder
          user.profilePictureFilename
        )

        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath)
          console.log(
            '🗑️ Deleted profile picture file for user:',
            userId,
            filePath
          )
        }
      }

      // Update user in MongoDB
      const result = await users.findOneAndUpdate(
        { firebaseUid: userId },
        {
          $unset: {
            profilePicture: '',
            profilePictureFilename: '',
          },
          $set: {
            updatedAt: new Date(),
          },
        },
        { returnDocument: 'after' }
      )

      // Update Firebase Auth
      try {
        await admin.auth().updateUser(userId, {
          photoURL: null,
        })
        console.log('✅ Firebase Auth photoURL removed for user:', userId)
      } catch (firebaseError) {
        console.warn(
          '⚠️ Firebase photoURL removal failed:',
          firebaseError.message
        )
      }

      console.log('✅ Profile picture deleted for user:', userId)

      res.json({
        success: true,
        user: result.value,
        message: 'Profile picture deleted successfully',
      })
    } catch (err) {
      console.error('❌ Error deleting profile picture:', err)
      res.status(500).json({
        success: false,
        error: 'Failed to delete profile picture',
        details: err.message,
      })
    }
  },
}

// ==============================
// GET ANY USER'S AVATAR (PUBLIC ROUTE)
// ==============================
const getOtherUserAvatarRoute = {
  method: 'get',
  path: '/users/:userId/avatar',
  middleware: [], // No auth required → public
  handler: async (req, res) => {
    try {
      const { users } = getCollections()
      const { userId } = req.params

      const user = await users.findOne(
        { firebaseUid: userId },
        { projection: { profilePicture: 1 } } // only fetch what we need
      )

      let profilePicture = null
      if (user?.profilePicture) {
        profilePicture = `${SERVER_BASE_URL}${user.profilePicture}`
      }

      // Optional: fallback to a default avatar
      // if (!profilePicture) profilePicture = `${SERVER_BASE_URL}/default-avatar.png`

      res.json({
        success: true,
        profilePicture, // null or full URL
      })
    } catch (err) {
      console.error('Failed to fetch avatar:', err)
      res.status(500).json({ success: false, error: 'Server error' })
    }
  },
}

module.exports = {
  getUserProfileRoute,
  updateUserProfileRoute,
  updateProfilePictureRoute,
  updatePasswordRoute,
  deleteProfilePictureRoute,
  getOtherUserAvatarRoute,
}
