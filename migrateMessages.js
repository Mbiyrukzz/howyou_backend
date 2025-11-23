// migrateMessages.js
const { MongoClient, ObjectId } = require('mongodb')

const uri = 'mongodb://10.197.1.87:27017' // change if needed
const dbName = 'your_db_name'

async function migrateMessages() {
  const client = new MongoClient(uri)

  try {
    await client.connect()
    const db = client.db(dbName)
    const messages = db.collection('messages')
    const chats = db.collection('chats')

    const allMessages = await messages.find({}).toArray()

    for (const msg of allMessages) {
      if (typeof msg.chatId === 'string') {
        try {
          const chatObjId = new ObjectId(msg.chatId)

          // Verify chat exists
          const chat = await chats.findOne({ _id: chatObjId })
          if (!chat) continue

          await messages.updateOne(
            { _id: msg._id },
            { $set: { chatId: chatObjId } }
          )

          console.log(`✅ Updated message ${msg._id}`)
        } catch (err) {
          console.warn(`⚠️ Skipped message ${msg._id}: invalid chatId`)
        }
      }
    }

    console.log('🎉 Migration completed.')
  } finally {
    await client.close()
  }
}

migrateMessages().catch(console.error)
