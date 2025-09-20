const { listChatsRoute } = require('./listChatsRoute')
const { sendMessageRoute } = require('./sendMessageRoute')
const { createUserRoute } = require('./createUserRoute')
const { createChatRoute } = require('./createChatRoute')
const { listContactsRoute } = require('./listContactsRoute')

const routes = [
  createUserRoute,
  createChatRoute,
  sendMessageRoute,
  listChatsRoute,
  listContactsRoute,
]

module.exports = { routes }
