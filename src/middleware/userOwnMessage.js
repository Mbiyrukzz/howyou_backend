const { getCollections } = require('../db')
const { ObjectId } = require('mongodb')

const userOwnMessage = async (req, res, next) => {
  console.log('userOwnMessage middleware EXECUTED')

  try {
    const uid = req.user.uid
    const messageId = req.params.messageId || req.body.messageId

    console.log('userOwnMessage → uid:', uid)
    console.log('userOwnMessage → messageId:', messageId)

    if (!messageId || !ObjectId.isValid(messageId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid or missing messageId',
      })
    }

    const { messages } = getCollections()
    const messageObjId = new ObjectId(messageId)

    console.log('Querying DB:', {
      _id: messageObjId.toString(),
      senderId: uid,
    })

    const message = await messages.findOne({
      _id: messageObjId,
      senderId: uid,
    })

    console.log('DB result:', message ? 'FOUND' : 'NOT FOUND')

    if (!message) {
      return res.status(403).json({
        success: false,
        error: 'You do not own this message',
      })
    }

    req.message = message
    console.log('req.message attached, proceeding...')
    next()
  } catch (e) {
    console.error('userOwnMessage error:', e)
    res.status(500).json({ success: false, error: e.message })
  }
}

module.exports = { userOwnMessage }
