// livekitService.js - For livekit-server-sdk v2.x (async)
const { AccessToken } = require('livekit-server-sdk')

const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET
const LIVEKIT_URL = process.env.LIVEKIT_URL

console.log('🔧 LiveKit Configuration:', {
  hasApiKey: !!LIVEKIT_API_KEY,
  hasApiSecret: !!LIVEKIT_API_SECRET,
  livekitUrl: LIVEKIT_URL,
  apiKeyPreview: LIVEKIT_API_KEY
    ? LIVEKIT_API_KEY.substring(0, 10) + '...'
    : 'missing',
})

/**
 * Generate a LiveKit access token (ASYNC for v2.x)
 */
async function generateToken(
  roomName,
  participantIdentity,
  participantName,
  options = {}
) {
  console.log('🎫 Generating LiveKit token:', {
    roomName,
    participantIdentity,
    participantName,
  })

  const {
    canPublish = true,
    canSubscribe = true,
    canPublishData = true,
    metadata = '',
  } = options

  const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
    identity: participantIdentity,
    name: participantName,
    metadata,
  })

  at.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish,
    canSubscribe,
    canPublishData,
  })

  // In v2.x, toJwt() might return a Promise or string
  const token = await Promise.resolve(at.toJwt())

  console.log('✅ Generated token:', {
    tokenPreview: token.substring(0, 50) + '...',
    tokenLength: token.length,
    isString: typeof token === 'string',
  })

  return token
}

/**
 * Generate tokens for both participants (ASYNC)
 */
async function generateCallTokens(chatId, caller, recipient) {
  console.log('🎬 Generating call tokens for:', {
    chatId,
    caller: caller.uid,
    recipient: recipient.uid,
  })

  const roomName = `call_${chatId}`

  const callerToken = await generateToken(roomName, caller.uid, caller.name, {
    metadata: JSON.stringify({ role: 'caller', userId: caller.uid }),
  })

  const recipientToken = await generateToken(
    roomName,
    recipient.uid,
    recipient.name,
    {
      metadata: JSON.stringify({ role: 'recipient', userId: recipient.uid }),
    }
  )

  const result = {
    roomName,
    callerToken,
    recipientToken,
    livekitUrl: LIVEKIT_URL,
  }

  console.log('✅ Generated call tokens:', {
    roomName,
    callerTokenType: typeof callerToken,
    callerTokenLength: callerToken.length,
    recipientTokenType: typeof recipientToken,
    recipientTokenLength: recipientToken.length,
    livekitUrl: LIVEKIT_URL,
  })

  return result
}

function validateConnection() {
  const isValid = !!(LIVEKIT_API_KEY && LIVEKIT_API_SECRET && LIVEKIT_URL)

  console.log('🔍 LiveKit validation:', {
    isValid,
    hasApiKey: !!LIVEKIT_API_KEY,
    hasApiSecret: !!LIVEKIT_API_SECRET,
    hasUrl: !!LIVEKIT_URL,
  })

  return isValid
}

module.exports = {
  generateToken,
  generateCallTokens,
  validateConnection,
  LIVEKIT_URL,
}
