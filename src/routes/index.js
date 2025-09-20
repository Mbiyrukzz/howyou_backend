const { listChatsRoute } = require('./listChatsRoute')
const { sendMessageRoute } = require('./sendMessageRoute')
const { createUserRoute } = require('./createUserRoute')
const { createChatRoute } = require('./createChatRoute')
const { createRoomRoute } = require('./createRoomRoute')
const { listUsersRoute } = require('./listUsersRoute')
const { listMessagesRoute } = require('./listMessagesRoute')

const routes = [
  createUserRoute,
  createChatRoute,
  sendMessageRoute,
  listChatsRoute,
  listMessagesRoute,

  listUsersRoute,
  createRoomRoute,
]

module.exports = { routes }
