const { getCollections } = require('../db')
const { verifyAuthToken } = require('../middleware/verifyAuthToken')

const createRoomRoute = {
  method: 'post',
  path: '/create-room',
  middleware: [verifyAuthToken],
  handler: async (req, res) => {
    try {
      const { name, description, categories } = req.body
      if (!name) {
        return res
          .status(400)
          .json({ success: false, error: 'Room name required' })
      }

      const { chats } = getCollections()
      const newRoom = {
        name,
        description: description || '',
        categories: categories || [],
        participants: [req.user.uid], // creator joins automatically
        isRoom: true,
        createdAt: new Date(),
      }

      const result = await chats.insertOne(newRoom)

      res.json({ success: true, chat: { ...newRoom, _id: result.insertedId } })
    } catch (err) {
      console.error('❌ Error creating room:', err)
      res.status(500).json({ success: false, error: 'Failed to create room' })
    }
  },
}

module.exports = { createRoomRoute }
