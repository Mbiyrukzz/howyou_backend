// routes/createPostRoute.js
const { getCollections } = require('../db')
const {
  uploadMultiple,
  getFileInfo,
} = require('../middleware/createUploadsDir')
const { verifyAuthToken } = require('../middleware/verifyAuthToken')

const SERVER_BASE_URL = process.env.SERVER_BASE_URL || 'http://localhost:5000'

const createPostRoute = {
  path: '/posts',
  method: 'post',
  middleware: [verifyAuthToken, uploadMultiple('files', 10)], // Max 10 images per post
  handler: async (req, res) => {
    console.log('\n=== Create Post Request ===')
    console.log('User UID:', req.user?.uid)
    console.log('Body:', req.body)
    console.log('Files received:', req.files?.length || 0)

    try {
      const { content } = req.body
      const files = req.files || []

      // Validation - content OR files required
      if (!content?.trim() && files.length === 0) {
        console.log('❌ No content or files provided')
        return res.status(400).json({
          success: false,
          error: 'Post must have content or at least one image',
        })
      }

      const { posts, users } = getCollections()

      // Verify user exists
      console.log('Looking for user with firebaseUid:', req.user.uid)
      const user = await users.findOne({ firebaseUid: req.user.uid })

      if (!user) {
        console.log('❌ User not found in database')
        return res.status(404).json({
          success: false,
          error: 'User not found',
        })
      }

      console.log('✅ User found:', {
        id: user._id,
        name: user.name,
        email: user.email,
      })

      // Process uploaded files
      const processedFiles = []
      for (const file of files) {
        const info = getFileInfo(file)
        const fullUrl = `${SERVER_BASE_URL}${info.url}`

        processedFiles.push({
          url: fullUrl,
          type: info.type, // 'image' or 'video'
          mimeType: file.mimetype,
          size: file.size,
          filename: file.filename,
          originalName: file.originalname,
        })

        console.log('Processed file:', {
          type: info.type,
          size: file.size,
          url: info.url,
        })
      }

      // Create new post
      const newPost = {
        userId: req.user.uid,
        username: user.name || 'User',
        avatarColor: user.avatarColor || '#3498db',
        content: content?.trim() || '',
        files: processedFiles,
        likes: 0,
        comments: 0,
        shares: 0,
        isLiked: false, // For this user
        likedBy: [], // Array of user IDs who liked this
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      console.log('Inserting post...')
      const result = await posts.insertOne(newPost)

      const createdPost = {
        ...newPost,
        _id: result.insertedId,
      }

      console.log('✅ Post created:', createdPost._id)
      console.log('Post details:', {
        content: createdPost.content?.substring(0, 50),
        filesCount: createdPost.files.length,
      })

      res.status(201).json({
        success: true,
        post: createdPost,
        message: 'Post created successfully',
      })
    } catch (err) {
      console.error('❌ Create post error:', err)
      console.error('Stack:', err.stack)
      res.status(500).json({
        success: false,
        error: 'Failed to create post',
        details:
          process.env.NODE_ENV === 'development' ? err.message : undefined,
      })
    }
  },
}

// GET all posts
const getPostsRoute = {
  path: '/posts',
  method: 'get',
  middleware: [verifyAuthToken],
  handler: async (req, res) => {
    console.log('\n=== Get Posts Request ===')
    console.log('User UID:', req.user?.uid)

    try {
      const { posts } = getCollections()
      const { page = 1, limit = 20 } = req.query

      const skip = (parseInt(page) - 1) * parseInt(limit)

      // Get posts with pagination
      const allPosts = await posts
        .find({})
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .toArray()

      // Add isLiked flag for current user
      const postsWithLikeStatus = allPosts.map((post) => ({
        ...post,
        isLiked: post.likedBy?.includes(req.user.uid) || false,
      }))

      console.log(`✅ Found ${postsWithLikeStatus.length} posts`)

      res.json({
        success: true,
        posts: postsWithLikeStatus,
        page: parseInt(page),
        hasMore: allPosts.length === parseInt(limit),
      })
    } catch (err) {
      console.error('❌ Get posts error:', err)
      res.status(500).json({
        success: false,
        error: 'Failed to fetch posts',
      })
    }
  },
}

// GET single post
const getPostRoute = {
  path: '/posts/:id',
  method: 'get',
  middleware: [verifyAuthToken],
  handler: async (req, res) => {
    try {
      const { ObjectId } = require('mongodb')
      const { posts } = getCollections()
      const postId = req.params.id

      const post = await posts.findOne({ _id: new ObjectId(postId) })

      if (!post) {
        return res.status(404).json({
          success: false,
          error: 'Post not found',
        })
      }

      // Add isLiked flag
      post.isLiked = post.likedBy?.includes(req.user.uid) || false

      res.json({ success: true, post })
    } catch (err) {
      console.error('Get post error:', err)
      res.status(500).json({
        success: false,
        error: 'Failed to fetch post',
      })
    }
  },
}

// UPDATE post (owner only)
const updatePostRoute = {
  path: '/posts/:id',
  method: 'put',
  middleware: [verifyAuthToken],
  handler: async (req, res) => {
    try {
      const { ObjectId } = require('mongodb')
      const { posts } = getCollections()
      const postId = req.params.id
      const { content } = req.body

      // Find post and verify ownership
      const post = await posts.findOne({
        _id: new ObjectId(postId),
        userId: req.user.uid,
      })

      if (!post) {
        return res.status(404).json({
          success: false,
          error: 'Post not found or not authorized',
        })
      }

      // Update post
      const result = await posts.updateOne(
        { _id: new ObjectId(postId) },
        {
          $set: {
            content: content?.trim(),
            updatedAt: new Date(),
          },
        }
      )

      const updatedPost = await posts.findOne({ _id: new ObjectId(postId) })
      updatedPost.isLiked = updatedPost.likedBy?.includes(req.user.uid) || false

      res.json({
        success: true,
        post: updatedPost,
        message: 'Post updated successfully',
      })
    } catch (err) {
      console.error('Update post error:', err)
      res.status(500).json({
        success: false,
        error: 'Failed to update post',
      })
    }
  },
}

// DELETE post (owner only)
const deletePostRoute = {
  path: '/posts/:id',
  method: 'delete',
  middleware: [verifyAuthToken],
  handler: async (req, res) => {
    console.log('\n=== Delete Post Request ===')
    console.log('Post ID:', req.params.id)
    console.log('User UID:', req.user?.uid)

    try {
      const { ObjectId } = require('mongodb')
      const { posts } = getCollections()
      const postId = req.params.id

      // Find post and verify ownership
      const post = await posts.findOne({
        _id: new ObjectId(postId),
        userId: req.user.uid,
      })

      if (!post) {
        console.log('❌ Post not found or not owner')
        return res.status(404).json({
          success: false,
          error: 'Post not found or not authorized',
        })
      }

      // Optional: Delete associated files
      if (post.files && post.files.length > 0) {
        const fs = require('fs').promises
        const path = require('path')

        for (const file of post.files) {
          try {
            const filePath = path.join(
              __dirname,
              '..',
              'uploads',
              file.filename
            )
            await fs.unlink(filePath)
            console.log('Deleted file:', file.filename)
          } catch (err) {
            console.log('Could not delete file:', err.message)
          }
        }
      }

      await posts.deleteOne({ _id: new ObjectId(postId) })
      console.log('✅ Post deleted')

      res.json({
        success: true,
        message: 'Post deleted successfully',
      })
    } catch (err) {
      console.error('❌ Delete post error:', err)
      res.status(500).json({
        success: false,
        error: 'Failed to delete post',
      })
    }
  },
}

// LIKE/UNLIKE post
const toggleLikeRoute = {
  path: '/posts/:id/like',
  method: 'put',
  middleware: [verifyAuthToken],
  handler: async (req, res) => {
    try {
      const { ObjectId } = require('mongodb')
      const { posts } = getCollections()
      const postId = req.params.id
      const userId = req.user.uid

      const post = await posts.findOne({ _id: new ObjectId(postId) })

      if (!post) {
        return res.status(404).json({
          success: false,
          error: 'Post not found',
        })
      }

      const likedBy = post.likedBy || []
      const hasLiked = likedBy.includes(userId)

      let update
      if (hasLiked) {
        // Unlike
        update = {
          $pull: { likedBy: userId },
          $inc: { likes: -1 },
          $set: { updatedAt: new Date() },
        }
      } else {
        // Like
        update = {
          $addToSet: { likedBy: userId },
          $inc: { likes: 1 },
          $set: { updatedAt: new Date() },
        }
      }

      await posts.updateOne({ _id: new ObjectId(postId) }, update)

      const updatedPost = await posts.findOne({ _id: new ObjectId(postId) })
      updatedPost.isLiked = updatedPost.likedBy?.includes(userId) || false

      res.json({
        success: true,
        post: updatedPost,
        liked: !hasLiked,
      })
    } catch (err) {
      console.error('Toggle like error:', err)
      res.status(500).json({
        success: false,
        error: 'Failed to toggle like',
      })
    }
  },
}

module.exports = {
  createPostRoute,
  getPostsRoute,
  getPostRoute,
  updatePostRoute,
  deletePostRoute,
  toggleLikeRoute,
}
