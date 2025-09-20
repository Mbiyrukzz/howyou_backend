const { getCollections } = require('../db')
const { verifyAuthToken } = require('../middleware/verifyAuthToken')

const listUsersRoute = {
  method: 'get',
  path: '/list-users',
  middleware: [verifyAuthToken],
  handler: async (req, res) => {
    try {
      console.log('👉 list-users called by:', req.user?.uid, req.user?.user_id)

      const { users } = getCollections()
      const foundUsers = await users.find({}).toArray()

      res.json(foundUsers)
    } catch (error) {
      console.error('❌ Error listing users:', error)
      res.status(500).json({ error: 'Failed to load users' })
    }
  },
}

module.exports = { listUsersRoute }
