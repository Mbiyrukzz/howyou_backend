// routes/commentRoutes.js - Fixed WebSocket Broadcasting
const { getCollections } = require('../db')
const {
  uploadMultiple,
  getFileInfo,
} = require('../middleware/createUploadsDir')
const { verifyAuthToken } = require('../middleware/verifyAuthToken')
const { ObjectId } = require('mongodb')

const SERVER_BASE_URL =
  process.env.SERVER_BASE_URL || 'http://10.156.197.87:5000'

// ✅ FIXED: Broadcast helper with better logging
function broadcastToWebSocket(clients, message, excludeUserId = null) {
  if (!clients || typeof clients.forEach !== 'function') {
    console.warn('⚠️ WebSocket clients not available for broadcasting')
    return
  }

  console.log('📡 Broadcasting:', message.type, 'to /posts clients')
  console.log('📊 Total clients:', clients.size)
  console.log('🚫 Excluding:', excludeUserId)

  let broadcastCount = 0
  clients.forEach((client, userId) => {
    console.log(
      `  Checking client: ${userId}, readyState: ${
        client.ws.readyState
      }, exclude: ${userId === excludeUserId}`
    )

    if (userId !== excludeUserId && client.ws.readyState === 1) {
      try {
        client.ws.send(JSON.stringify(message))
        broadcastCount++
        console.log(`  ✅ Sent to ${userId}`)
      } catch (error) {
        console.error(`  ❌ Failed to send to ${userId}:`, error.message)
      }
    }
  })

  console.log(
    `✅ Broadcasted ${message.type} to ${broadcastCount} users (excluded ${
      excludeUserId ? 1 : 0
    })`
  )
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
    console.log('Content:', req.body.content)
    console.log('Files:', req.files?.length || 0)

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
        console.error('❌ Post not found:', postId)
        return res.status(404).json({
          success: false,
          error: 'Post not found',
        })
      }

      // Validate parent comment if provided
      let parentComment = null
      if (parentId) {
        console.log('🔍 Looking for parent comment:', parentId)
        parentComment = await comments.findOne({
          _id: new ObjectId(parentId),
          postId: new ObjectId(postId), // ✅ FIX: Ensure postId is ObjectId
        })

        if (!parentComment) {
          console.error('❌ Parent comment not found:', parentId)
          console.log('🔍 Checking all comments for this post...')
          const allComments = await comments
            .find({ postId: new ObjectId(postId) })
            .toArray()
          console.log(
            'All comment IDs:',
            allComments.map((c) => c._id.toString())
          )

          return res.status(404).json({
            success: false,
            error: 'Parent comment not found',
          })
        }
        console.log('✅ Parent comment found:', parentComment._id)
      }

      // Get user
      const user = await users.findOne({ firebaseUid: req.user.uid })
      if (!user) {
        console.error('❌ User not found:', req.user.uid)
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
      const newCommentId = new ObjectId()
      const newComment = {
        _id: newCommentId,
        postId: new ObjectId(postId),
        userId: req.user.uid,
        username: user.name || 'User',
        avatarColor: user.avatarColor || '#3498db',
        content: content?.trim() || '',
        files: processedFiles,
        parentId: parentId ? new ObjectId(parentId) : null,
        path: parentComment
          ? `${parentComment.path}.${newCommentId}`
          : `${newCommentId}`, // For efficient threading
        likes: 0,
        likedBy: [],
        isLiked: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      const result = await comments.insertOne(newComment)
      console.log('✅ Comment inserted:', result.insertedId)

      const createdComment = { ...newComment, _id: result.insertedId }
      createdComment.isLiked = false

      // Update post comment count
      await posts.updateOne(
        { _id: new ObjectId(postId) },
        { $inc: { comments: 1 }, $set: { updatedAt: new Date() } }
      )

      // ✅ FIXED: Broadcast to /posts WebSocket clients
      console.log('📡 Attempting WebSocket broadcast...')
      console.log('WebSocket clients available:', !!req.app.postsClients)

      if (req.app.postsClients) {
        console.log('✅ postsClients found, broadcasting...')
        broadcastToWebSocket(
          req.app.postsClients,
          {
            type: 'new-comment',
            postId: postId, // Keep as string for frontend
            comment: {
              ...createdComment,
              _id: createdComment._id.toString(), // Convert ObjectId to string
              postId: createdComment.postId.toString(),
              parentId: createdComment.parentId
                ? createdComment.parentId.toString()
                : null,
            },
            parentId: parentId || null,
            senderId: req.user.uid,
            timestamp: new Date().toISOString(),
          },
          req.user.uid
        )
      } else if (req.app.wsClients) {
        // Fallback to old wsClients
        console.log('⚠️ Using fallback wsClients')
        broadcastToWebSocket(
          req.app.wsClients,
          {
            type: 'new-comment',
            postId: postId,
            comment: {
              ...createdComment,
              _id: createdComment._id.toString(),
              postId: createdComment.postId.toString(),
              parentId: createdComment.parentId
                ? createdComment.parentId.toString()
                : null,
            },
            parentId: parentId || null,
            senderId: req.user.uid,
            timestamp: new Date().toISOString(),
          },
          req.user.uid
        )
      } else {
        console.error('❌ No WebSocket clients available!')
      }

      // Convert ObjectIds to strings for response
      const responseComment = {
        ...createdComment,
        _id: createdComment._id.toString(),
        postId: createdComment.postId.toString(),
        parentId: createdComment.parentId
          ? createdComment.parentId.toString()
          : null,
      }

      res.status(201).json({
        success: true,
        comment: responseComment,
        message: 'Comment added',
      })
    } catch (err) {
      console.error('❌ Create comment error:', err)
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

      // Get all replies for these comments
      const commentIds = topLevel.map((c) => c._id.toString())

      const allReplies = await comments
        .find({
          postId: new ObjectId(postId),
          parentId: { $ne: null },
        })
        .toArray()

      // Build nested structure
      const buildRepliesTree = (parentId) => {
        const parentIdStr = parentId.toString()
        return allReplies
          .filter(
            (reply) =>
              reply.parentId && reply.parentId.toString() === parentIdStr
          )
          .map((reply) => ({
            ...reply,
            _id: reply._id.toString(),
            postId: reply.postId.toString(),
            parentId: reply.parentId ? reply.parentId.toString() : null,
            isLiked: reply.likedBy?.includes(userId) || false,
            replies: buildRepliesTree(reply._id),
          }))
          .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
      }

      const finalComments = topLevel.map((comment) => ({
        ...comment,
        _id: comment._id.toString(),
        postId: comment.postId.toString(),
        parentId: null,
        isLiked: comment.likedBy?.includes(userId) || false,
        replies: buildRepliesTree(comment._id),
      }))

      console.log(`✅ Returning ${finalComments.length} top-level comments`)

      res.json({
        success: true,
        comments: finalComments,
        page: parseInt(page),
        hasMore: topLevel.length === parseInt(limit),
      })
    } catch (err) {
      console.error('❌ Get comments error:', err)
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

      const responseComment = {
        ...updatedComment,
        _id: updatedComment._id.toString(),
        postId: updatedComment.postId.toString(),
        parentId: updatedComment.parentId
          ? updatedComment.parentId.toString()
          : null,
        isLiked: updatedComment.likedBy?.includes(userId) || false,
      }

      // Update post's updatedAt
      await posts.updateOne(
        { _id: comment.postId },
        { $set: { updatedAt: new Date() } }
      )

      // Broadcast
      if (req.app.postsClients || req.app.wsClients) {
        broadcastToWebSocket(
          req.app.postsClients || req.app.wsClients,
          {
            type: 'comment-updated',
            commentId: commentId,
            postId: comment.postId.toString(),
            content: content?.trim(),
            senderId: userId,
            timestamp: new Date().toISOString(),
          },
          userId
        )
      }

      res.json({
        success: true,
        comment: responseComment,
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

      // Delete comment and all its replies
      const commentIdStr = commentId
      const allToDelete = await comments
        .find({
          $or: [
            { _id: new ObjectId(commentId) },
            { path: new RegExp(`${commentIdStr}`) },
          ],
        })
        .toArray()

      const deleteResult = await comments.deleteMany({
        _id: { $in: allToDelete.map((c) => c._id) },
      })

      // Update post comment count
      await posts.updateOne(
        { _id: comment.postId },
        {
          $inc: { comments: -deleteResult.deletedCount },
          $set: { updatedAt: new Date() },
        }
      )

      // Broadcast
      if (req.app.postsClients || req.app.wsClients) {
        broadcastToWebSocket(
          req.app.postsClients || req.app.wsClients,
          {
            type: 'comment-deleted',
            commentId: commentId,
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

      const responseComment = {
        ...updatedComment,
        _id: updatedComment._id.toString(),
        postId: updatedComment.postId.toString(),
        parentId: updatedComment.parentId
          ? updatedComment.parentId.toString()
          : null,
        isLiked: !hasLiked,
      }

      // Update post timestamp
      await posts.updateOne(
        { _id: comment.postId },
        { $set: { updatedAt: new Date() } }
      )

      // Broadcast
      if (req.app.postsClients || req.app.wsClients) {
        broadcastToWebSocket(
          req.app.postsClients || req.app.wsClients,
          {
            type: hasLiked ? 'comment-unliked' : 'comment-liked',
            commentId: commentId,
            postId: comment.postId.toString(),
            userId,
            newLikeCount: responseComment.likes,
            timestamp: new Date().toISOString(),
          },
          userId
        )
      }

      res.json({
        success: true,
        comment: responseComment,
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
