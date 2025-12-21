// routes/createPostRoute.js - Enhanced with WebSocket broadcasting
const { getCollections } = require('../db')
const {
  uploadMultiple,
  getFileInfo,
} = require('../middleware/createUploadsDir')
const { verifyAuthToken } = require('../middleware/verifyAuthToken')

const SERVER_BASE_URL = 'http://10.60.144.87:5000'

// ✅ Helper function to broadcast to WebSocket clients
function broadcastToWebSocket(clients, message, excludeUserId = null) {
  if (!clients || typeof clients.forEach !== 'function') {
    console.warn('⚠️ WebSocket clients not available for broadcasting')
    return
  }

  let broadcastCount = 0
  clients.forEach((client, userId) => {
    if (userId !== excludeUserId && client.ws.readyState === 1) {
      // 1 = OPEN
      try {
        client.ws.send(JSON.stringify(message))
        broadcastCount++
      } catch (error) {
        console.error(`Failed to send to ${userId}:`, error.message)
      }
    }
  })

  console.log(`📡 Broadcasted ${message.type} to ${broadcastCount} users`)
}

const createPostRoute = {
  path: '/posts',
  method: 'post',
  middleware: [verifyAuthToken, uploadMultiple('files', 10)],
  handler: async (req, res) => {
    console.log('\n=== Create Post Request ===')
    console.log('User UID:', req.user?.uid)
    console.log('Body:', req.body)
    console.log('Files received:', req.files?.length || 0)

    try {
      const { content } = req.body
      const files = req.files || []

      if (!content?.trim() && files.length === 0) {
        console.log('❌ No content or files provided')
        return res.status(400).json({
          success: false,
          error: 'Post must have content or at least one image',
        })
      }

      const { posts, users } = getCollections()

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
          type: info.type,
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
        isLiked: false,
        likedBy: [],
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

      // ✅ Broadcast to WebSocket clients
      if (req.app.wsClients) {
        broadcastToWebSocket(
          req.app.wsClients,
          {
            type: 'new-post',
            post: createdPost,
            senderId: req.user.uid,
            timestamp: new Date().toISOString(),
          },
          req.user.uid // Exclude sender
        )
      }

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

      const allPosts = await posts
        .find({})
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .toArray()

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

      // ✅ Broadcast update
      if (req.app.wsClients) {
        broadcastToWebSocket(
          req.app.wsClients,
          {
            type: 'post-updated',
            postId,
            post: updatedPost,
            senderId: req.user.uid,
            timestamp: new Date().toISOString(),
          },
          req.user.uid
        )
      }

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

      // ✅ Broadcast deletion
      if (req.app.wsClients) {
        broadcastToWebSocket(
          req.app.wsClients,
          {
            type: 'post-deleted',
            postId,
            senderId: req.user.uid,
            timestamp: new Date().toISOString(),
          },
          req.user.uid
        )
      }

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

      // ✅ Broadcast like/unlike event
      if (req.app.wsClients) {
        broadcastToWebSocket(
          req.app.wsClients,
          {
            type: hasLiked ? 'post-unliked' : 'post-liked',
            postId,
            userId,
            newLikeCount: updatedPost.likes,
            timestamp: new Date().toISOString(),
          },
          userId
        )
      }

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
