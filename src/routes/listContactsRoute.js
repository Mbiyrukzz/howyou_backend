const { getCollections } = require('../db')
const { verifyAuthToken } = require('../middleware/verifyAuthToken')
const { ObjectId } = require('mongodb')

const listContactsRoute = {
  method: 'get',
  path: '/list-contacts',
  middleware: [verifyAuthToken],
  handler: async (req, res) => {
    try {
      const { users } = getCollections()
      const currentUid = req.user.uid

      const contacts = await users
        .find({ firebaseUid: { $ne: currentUid } })
        .project({ password: 0 })
        .toArray()

      res.json({ success: true, contacts })
    } catch (err) {
      console.error('❌ Error listing contacts:', err)
      res.status(500).json({ success: false, error: 'Failed to load contacts' })
    }
  },
}

module.exports = { listContactsRoute }
