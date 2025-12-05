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
  cancelCallRoute,
} = require('./initiateCallRoute')
const { sendMessageRoute } = require('./sendMessageRoute')
const { savePushTokenRoute, getPushTokenRoute } = require('./pushNotifications')
const { deleteChatRoute } = require('./deleteChatRoutes')

const { updateMessageRoute } = require('./updateMessageRoute')
const {
  markMessagesAsReadRoute,
  markMessagesAsDeliveredRoute,
} = require('./markMessagesStatus')
const {
  createStatusRoute,
  getStatusesRoute,
  deleteStatusRoute,
  getMyStatusRoute,
} = require('./createStatusRoute')
const {
  createPostRoute,
  getPostRoute,
  updatePostRoute,

  toggleLikeRoute,
  getPostsRoute,
  deletePostRoute,
} = require('./createPostRoute')

const { updateLastSeenRoute } = require('./updateLastSeen')
const { deleteMessageRoute } = require('./deleteMessageRoute')
const {
  createCommentRoute,
  updateCommentRoute,
  deleteCommentRoute,
  getCommentsRoute,
  toggleLikeCommentRoute,
} = require('./commentsRoutes')
const {
  markStatusViewedRoute,
  getStatusViewsRoute,
  getMyStatusViewsSummaryRoute,
  hasViewedStatusRoute,
} = require('./statusViewRoutes')
const { deleteCallLogRoute } = require('./deleteCallLog')
const {
  updateUserProfileRoute,
  getUserProfileRoute,
  deleteProfilePictureRoute,
  updatePasswordRoute,
  updateProfilePictureRoute,
} = require('./updateUserRoute')

const routes = [
  createUserRoute,
  updateUserProfileRoute,
  updateProfilePictureRoute,
  updatePasswordRoute,
  deleteProfilePictureRoute,
  getUserProfileRoute,

  createChatRoute,
  deleteChatRoute,
  sendMessageRoute,
  listChatsRoute,
  listMessagesRoute,
  updateMessageRoute,
  deleteMessageRoute,

  markMessagesAsReadRoute,
  markMessagesAsDeliveredRoute,
  updateLastSeenRoute,

  createStatusRoute,
  getStatusesRoute,
  deleteStatusRoute,
  getMyStatusRoute,

  markStatusViewedRoute,
  getStatusViewsRoute,
  getMyStatusViewsSummaryRoute,
  hasViewedStatusRoute,

  createPostRoute,
  getPostRoute,
  getPostsRoute,
  updatePostRoute,
  deletePostRoute,

  createCommentRoute,
  updateCommentRoute,
  deleteCommentRoute,
  getCommentsRoute,

  toggleLikeCommentRoute,

  toggleLikeRoute,

  listUsersRoute,
  createRoomRoute,

  initiateCallRoute,
  answerCallRoute,
  endCallRoute,
  cancelCallRoute,
  getCallHistoryRoute,
  deleteCallLogRoute,

  savePushTokenRoute,
  getPushTokenRoute,
]

module.exports = { routes }
