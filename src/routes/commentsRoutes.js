// routes/commentRoutes.js - Nested Comments with WebSocket
const { getCollections } = require('../db')
const {
  uploadMultiple,
  getFileInfo,
} = require('../middleware/createUploadsDir')
const { verifyAuthToken } = require('../middleware/verifyAuthToken')
const { ObjectId } = require('mongodb')

const SERVER_BASE_URL = process.env.SERVER_BASE_URL || 'http://localhost:5000'

// Reuse broadcast helper (you can extract to utils if needed)
function broadcastToWebSocket(clients, message, excludeUserId = null) {
  if (!clients || typeof clients.forEach !== 'function') {
    console.warn('WebSocket clients not available for broadcasting')
    return
  }

  let broadcastCount = 0
  clients.forEach((client, userId) => {
    if (userId !== excludeUserId && client.ws.readyState === 1) {
      try {
        client.ws.send(JSON.stringify(message))
        broadcastCount++
      } catch (error) {
        console.error(`Failed to send to ${userId}:`, error.message)
      }
    }
  })

  console.log(`Broadcasted ${message.type} to ${broadcastCount} users`)
}

// CREATE Comment (or Reply)
const createCommentRoute = {
  path: '/posts/:postId/comments',
  method: 'post',
  middleware: [verifyAuthToken, uploadMultiple('files', 5)],
  handler: async (req, res) => {
    console.log('\n=== Create Comment Request ===')
    console.log('Post ID:', req.params.postId)
    console.log('Parent Comment ID:', req.body.parentId || 'None (top-level)')
    console.log('User UID:', req.user?.uid)

    try {
      const { content, parentId } = req.body
      const files = req.files || []
      const postId = req.params.postId

      if (!content?.trim() && files.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Comment must have content or at least one file',
        })
      }

      const { posts, comments, users } = getCollections()

      // Validate post exists
      const post = await posts.findOne({ _id: new ObjectId(postId) })
      if (!post) {
        return res.status(404).json({
          success: false,
          error: 'Post not found',
        })
      }

      // Validate parent comment if provided
      let parentComment = null
      if (parentId) {
        parentComment = await comments.findOne({
          _id: new ObjectId(parentId),
          postId,
        })
        if (!parentComment) {
          return res.status(404).json({
            success: false,
            error: 'Parent comment not found',
          })
        }
      }

      // Get user
      const user = await users.findOne({ firebaseUid: req.user.uid })
      if (!user) {
        return res.status(404).json({
          success: false,
          error: 'User not found',
        })
      }

      // Process files
      const processedFiles = files.map((file) => {
        const info = getFileInfo(file)
        return {
          url: `${SERVER_BASE_URL}${info.url}`,
          type: info.type,
          mimeType: file.mimetype,
          size: file.size,
          filename: file.filename,
          originalName: file.originalname,
        }
      })

      // Build comment
      const newComment = {
        postId: new ObjectId(postId),
        userId: req.user.uid,
        username: user.name || 'User',
        avatarColor: user.avatarColor || '#3498db',
        content: content?.trim() || '',
        files: processedFiles,
        parentId: parentId ? new ObjectId(parentId) : null,
        path: parentComment
          ? `${parentComment.path}.${new ObjectId()}`
          : `${new ObjectId()}`, // For efficient threading
        likes: 0,
        likedBy: [],
        isLiked: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      const result = await comments.insertOne(newComment)
      const createdComment = { ...newComment, _id: result.insertedId }
      createdComment.isLiked = false

      // Update post comment count
      await posts.updateOne(
        { _id: new ObjectId(postId) },
        { $inc: { comments: 1 }, $set: { updatedAt: new Date() } }
      )

      // Broadcast
      if (req.app.wsClients) {
        broadcastToWebSocket(
          req.app.wsClients,
          {
            type: 'new-comment',
            postId,
            comment: createdComment,
            parentId: parentId || null,
            senderId: req.user.uid,
            timestamp: new Date().toISOString(),
          },
          req.user.uid
        )
      }

      res.status(201).json({
        success: true,
        comment: createdComment,
        message: 'Comment added',
      })
    } catch (err) {
      console.error('Create comment error:', err)
      res.status(500).json({
        success: false,
        error: 'Failed to create comment',
        details:
          process.env.NODE_ENV === 'development' ? err.message : undefined,
      })
    }
  },
}

// GET Comments for a Post (with pagination & nested structure)
const getCommentsRoute = {
  path: '/posts/:postId/comments',
  method: 'get',
  middleware: [verifyAuthToken],
  handler: async (req, res) => {
    console.log('\n=== Get Comments Request ===')
    console.log('Post ID:', req.params.postId)

    try {
      const { comments } = getCollections()
      const postId = req.params.postId
      const { page = 1, limit = 15 } = req.query
      const skip = (parseInt(page) - 1) * parseInt(limit)
      const userId = req.user.uid

      // Get top-level comments (parentId: null)
      const topLevel = await comments
        .find({ postId: new ObjectId(postId), parentId: null })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .toArray()

      const commentIds = topLevel.map((c) => c._id)

      // Get all replies in one query using path regex
      const allReplies = await comments
        .find({
          postId: new ObjectId(postId),
          path: { $in: commentIds.map((id) => new RegExp(`^${id}`)) },
        })
        .toArray()

      // Build tree structure
      const replyMap = {}
      allReplies.forEach((reply) => {
        replyMap[reply._id.toString()] = { ...reply, replies: [] }
      })

      topLevel.forEach((comment) => {
        const commentStrId = comment._id.toString()
        comment.replies = []
        comment.isLiked = comment.likedBy?.includes(userId) || false

        allReplies.forEach((reply) => {
          if (reply.path.startsWith(commentStrId + '.')) {
            const replyObj = replyMap[reply._id.toString()]
            replyObj.isLiked = reply.likedBy?.includes(userId) || false
            comment.replies.push(replyObj)
          }
        })

        // Sort replies by createdAt
        comment.replies.sort((a, b) => a.createdAt - b.createdAt)
      })

      const finalComments = topLevel.map((c) => ({
        ...c,
        _id: c._id,
        isLiked: c.isLiked,
      }))

      res.json({
        success: true,
        comments: finalComments,
        page: parseInt(page),
        hasMore: topLevel.length === parseInt(limit),
      })
    } catch (err) {
      console.error('Get comments error:', err)
      res.status(500).json({
        success: false,
        error: 'Failed to fetch comments',
      })
    }
  },
}

// UPDATE Comment (owner only)
const updateCommentRoute = {
  path: '/comments/:id',
  method: 'put',
  middleware: [verifyAuthToken],
  handler: async (req, res) => {
    try {
      const { comments, posts } = getCollections()
      const commentId = req.params.id
      const { content } = req.body
      const userId = req.user.uid

      const comment = await comments.findOne({
        _id: new ObjectId(commentId),
        userId,
      })

      if (!comment) {
        return res.status(404).json({
          success: false,
          error: 'Comment not found or not authorized',
        })
      }

      await comments.updateOne(
        { _id: new ObjectId(commentId) },
        { $set: { content: content?.trim(), updatedAt: new Date() } }
      )

      const updatedComment = await comments.findOne({
        _id: new ObjectId(commentId),
      })
      updatedComment.isLiked = updatedComment.likedBy?.includes(userId) || false

      // Update post's updatedAt
      await posts.updateOne(
        { _id: comment.postId },
        { $set: { updatedAt: new Date() } }
      )

      // Broadcast
      if (req.app.wsClients) {
        broadcastToWebSocket(
          req.app.wsClients,
          {
            type: 'comment-updated',
            commentId,
            postId: comment.postId.toString(),
            comment: updatedComment,
            senderId: userId,
            timestamp: new Date().toISOString(),
          },
          userId
        )
      }

      res.json({
        success: true,
        comment: updatedComment,
        message: 'Comment updated',
      })
    } catch (err) {
      console.error('Update comment error:', err)
      res.status(500).json({
        success: false,
        error: 'Failed to update comment',
      })
    }
  },
}

// DELETE Comment (owner only)
const deleteCommentRoute = {
  path: '/comments/:id',
  method: 'delete',
  middleware: [verifyAuthToken],
  handler: async (req, res) => {
    console.log('\n=== Delete Comment Request ===')
    console.log('Comment ID:', req.params.id)

    try {
      const { comments, posts } = getCollections()
      const commentId = req.params.id
      const userId = req.user.uid

      const comment = await comments.findOne({
        _id: new ObjectId(commentId),
        userId,
      })

      if (!comment) {
        return res.status(404).json({
          success: false,
          error: 'Comment not found or not authorized',
        })
      }

      // Delete all replies recursively
      const deleteResult = await comments.deleteMany({
        $or: [
          { _id: new ObjectId(commentId) },
          { path: new RegExp(`^${commentId}`) },
        ],
      })

      // Delete associated files
      const fs = require('fs').promises
      const path = require('path')
      const allDeleted = await comments
        .find({
          _id: { $in: [new ObjectId(commentId), ...deleteResult.deletedIds] },
        })
        .toArray()

      for (const c of allDeleted) {
        if (c.files) {
          for (const file of c.files) {
            try {
              const filePath = path.join(
                __dirname,
                '..',
                'uploads',
                file.filename
              )
              await fs.unlink(filePath)
            } catch (err) {
              console.warn('Could not delete file:', file.filename)
            }
          }
        }
      }

      // Update post comment count
      await posts.updateOne(
        { _id: comment.postId },
        {
          $inc: { comments: -deleteResult.deletedCount },
          $set: { updatedAt: new Date() },
        }
      )

      // Broadcast
      if (req.app.wsClients) {
        broadcastToWebSocket(
          req.app.wsClients,
          {
            type: 'comment-deleted',
            commentId,
            postId: comment.postId.toString(),
            replyCountDeleted: deleteResult.deletedCount - 1,
            senderId: userId,
            timestamp: new Date().toISOString(),
          },
          userId
        )
      }

      res.json({
        success: true,
        message: 'Comment and replies deleted',
      })
    } catch (err) {
      console.error('Delete comment error:', err)
      res.status(500).json({
        success: false,
        error: 'Failed to delete comment',
      })
    }
  },
}

// TOGGLE LIKE on Comment
const toggleLikeCommentRoute = {
  path: '/comments/:id/like',
  method: 'put',
  middleware: [verifyAuthToken],
  handler: async (req, res) => {
    try {
      const { comments, posts } = getCollections()
      const commentId = req.params.id
      const userId = req.user.uid

      const comment = await comments.findOne({ _id: new ObjectId(commentId) })
      if (!comment) {
        return res.status(404).json({
          success: false,
          error: 'Comment not found',
        })
      }

      const hasLiked = comment.likedBy?.includes(userId) || false
      const update = hasLiked
        ? { $pull: { likedBy: userId }, $inc: { likes: -1 } }
        : { $addToSet: { likedBy: userId }, $inc: { likes: 1 } }

      update.$set = { updatedAt: new Date() }

      await comments.updateOne({ _id: new ObjectId(commentId) }, update)

      const updatedComment = await comments.findOne({
        _id: new ObjectId(commentId),
      })
      updatedComment.isLiked = !hasLiked

      // Update post timestamp
      await posts.updateOne(
        { _id: comment.postId },
        { $set: { updatedAt: new Date() } }
      )

      // Broadcast
      if (req.app.wsClients) {
        broadcastToWebSocket(
          req.app.wsClients,
          {
            type: hasLiked ? 'comment-unliked' : 'comment-liked',
            commentId,
            postId: comment.postId.toString(),
            userId,
            newLikeCount: updatedComment.likes,
            timestamp: new Date().toISOString(),
          },
          userId
        )
      }

      res.json({
        success: true,
        comment: updatedComment,
        liked: !hasLiked,
      })
    } catch (err) {
      console.error('Toggle comment like error:', err)
      res.status(500).json({
        success: false,
        error: 'Failed to toggle like',
      })
    }
  },
}

module.exports = {
  createCommentRoute,
  getCommentsRoute,
  updateCommentRoute,
  deleteCommentRoute,
  toggleLikeCommentRoute,
}
