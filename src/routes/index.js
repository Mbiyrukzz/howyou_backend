const { listChatsRoute } = require('./listChatsRoute')
const { sendMessageRoute } = require('./sendMessageRoute')
const { createUserRoute } = require('./createUserRoute')

const routes = [createUserRoute, sendMessageRoute, listChatsRoute]

module.exports = { routes }
