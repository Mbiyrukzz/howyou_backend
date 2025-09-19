// routes/listChatsRoute.js
const { ObjectId } = require('mongodb')

const listChatsRoute = {
  method: 'get',
  path: '/chats',
  handler: async (req, res) => {
    try {
      const db = req.app.locals.db // db attached in server.js
      const chatsCollection = db.collection('chats')

      // Example: fetch all chats
      const chats = await chatsCollection
        .find({})
        .sort({ updatedAt: -1 }) // latest first
        .toArray()

      res.status(200).json(chats)
    } catch (error) {
      console.error('Error fetching chats:', error)
      res.status(500).json({ error: 'Failed to fetch chats' })
    }
  },
}

module.exports = { listChatsRoute }
