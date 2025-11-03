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
const { updateMessageRoute } = require('./updateMessageRoute')
const {
  markMessagesAsReadRoute,
  markMessagesAsDeliveredRoute,
} = require('./markMessagesStatus')
const {
  createStatusRoute,
  getStatusesRoute,
  deleteStatusRoute,
} = require('./createStatusRoute')
const {
  createPostRoute,
  getPostRoute,
  updatePostRoute,
  deletePostRoute,
  toggleLikeRoute,
  getPostsRoute,
} = require('./createPostRoute')
const { getMyStatusRoute } = require('./getMyStatusRoute')
const { updateLastSeenRoute } = require('./updateLastSeen')

const routes = [
  createUserRoute,

  createChatRoute,
  deleteChatRoute,
  sendMessageRoute,
  listChatsRoute,
  listMessagesRoute,
  deleteMessageRoute,
  updateMessageRoute,

  markMessagesAsReadRoute,
  markMessagesAsDeliveredRoute,
  updateLastSeenRoute,

  createStatusRoute,
  getStatusesRoute,
  deleteStatusRoute,
  getMyStatusRoute,

  createPostRoute,
  getPostRoute,
  getPostsRoute,
  updatePostRoute,
  deletePostRoute,
  toggleLikeRoute,

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
