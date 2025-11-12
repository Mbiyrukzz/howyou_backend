const { MongoClient } = require('mongodb')

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017'
const DB_NAME = 'chat_app'

let client, db

const initializeDbConnection = async () => {
  if (db) return db // reuse if already connected

  client = new MongoClient(MONGODB_URI)
  await client.connect()
  db = client.db(DB_NAME)

  console.log(`✅ Connected to MongoDB: ${DB_NAME}`)
  return db
}

const getDb = () => {
  if (!db) throw new Error('Database not initialized')
  return db
}

const getCollections = () => {
  const database = getDb()
  return {
    users: database.collection('users'),
    chats: database.collection('chats'),
    messages: database.collection('messages'),
    rooms: database.collection('rooms'),
    participants: database.collection('participants'),
    calls: database.collection('calls'),
    voice: database.collection('voice'),
    statuses: db.collection('statuses'),
    posts: db.collection('posts'),
    comments: db.collection('comments'),
  }
}

module.exports = {
  initializeDbConnection,
  getDb,
  getCollections,
}
