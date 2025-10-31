// backend/middleware/updateLastSeen.js
const { getCollections } = require('../db')

const updateLastSeen = async (req, res, next) => {
  const { users } = getCollections()
  const userId = req.user?.uid

  if (userId) {
    try {
      await users.updateOne(
        { firebaseUid: userId },
        { $set: { lastSeen: new Date(), online: true } }
      )
      console.log(`Updated last seen for user ${userId}`)
    } catch (err) {
      console.error('Error updating last seen:', err)
    }
  }
  next()
}

module.exports = { updateLastSeen }
