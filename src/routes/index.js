const { listChatsRoute } = require('./listChatsRoute')

const { createUserRoute } = require('./createUserRoute')
const { createChatRoute } = require('./createChatRoute')
const { createRoomRoute } = require('./createRoomRoute')
const { listUsersRoute } = require('./listUsersRoute')
const { listMessagesRoute } = require('./listMessagesRoute')
const {
  initiateCallRoute,
  answerCallRoute,
  endCallRoute,
  getCallHistoryRoute,
} = require('./initiateCallRoute')
const { sendMessageRoute } = require('./sendMessageRoute')

const routes = [
  createUserRoute,
  createChatRoute,
  sendMessageRoute,
  listChatsRoute,
  listMessagesRoute,

  listUsersRoute,
  createRoomRoute,

  initiateCallRoute,
  answerCallRoute,
  endCallRoute,
  getCallHistoryRoute,
]

module.exports = { routes }
