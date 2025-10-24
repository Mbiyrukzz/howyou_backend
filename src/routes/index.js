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
const { savePushTokenRoute, getPushTokenRoute } = require('./pushNotifications')
const { deleteChatRoute } = require('./deleteChatRoutes')
const { deleteMessageRoute } = require('./deleteMessageRoute')

const routes = [
  createUserRoute,

  createChatRoute,
  deleteChatRoute,
  sendMessageRoute,
  listChatsRoute,
  listMessagesRoute,
  deleteMessageRoute,

  listUsersRoute,
  createRoomRoute,

  initiateCallRoute,
  answerCallRoute,
  endCallRoute,
  getCallHistoryRoute,

  savePushTokenRoute,
  getPushTokenRoute,
]

module.exports = { routes }
