const { getCollections } = require('../db')
const { Expo } = require('expo-server-sdk')

const expo = new Expo()

/**
 * Send push notification for incoming call
 * @param {string} recipientId - Firebase UID of the recipient
 * @param {string} callerName - Name of the caller
 * @param {string} callType - 'voice' or 'video'
 * @param {object} callData - Additional call data
 * @returns {Promise<boolean>} - True if notification was sent successfully
 */
async function sendCallNotification(
  recipientId,
  callerName,
  callType,
  callData
) {
  try {
    const { users } = getCollections()

    // Get recipient's push token from MongoDB
    const recipient = await users.findOne({ firebaseUid: recipientId })

    if (!recipient) {
      console.log('⚠️ Recipient not found:', recipientId)
      return false
    }

    if (!recipient.pushToken) {
      console.log('⚠️ No push token for user:', recipientId)
      return false
    }

    const pushToken = recipient.pushToken

    if (!Expo.isExpoPushToken(pushToken)) {
      console.log('⚠️ Invalid push token format:', pushToken)
      return false
    }

    // Prepare the notification message
    const message = {
      to: pushToken,
      sound: 'default',
      title: `Incoming ${callType === 'video' ? 'Video' : 'Voice'} Call`,
      body: `${callerName} is calling you`,
      data: {
        type: 'incoming_call',
        callId: callData.callId,
        chatId: callData.chatId,
        caller: callData.caller,
        callerName: callerName,
        callType: callType,
        timestamp: new Date().toISOString(),
      },
      priority: 'high',
      channelId: 'calls',
      badge: 1,
    }

    console.log('📤 Sending push notification:', {
      to: recipientId,
      title: message.title,
    })

    // Send the notification
    const chunks = expo.chunkPushNotifications([message])
    const tickets = []

    for (let chunk of chunks) {
      try {
        const ticketChunk = await expo.sendPushNotificationsAsync(chunk)
        tickets.push(...ticketChunk)
        console.log('✅ Push notification sent:', ticketChunk)
      } catch (error) {
        console.error('❌ Error sending push notification chunk:', error)
      }
    }

    // Check for errors in tickets
    for (let ticket of tickets) {
      if (ticket.status === 'error') {
        console.error('❌ Push notification error:', ticket.message)
        if (ticket.details?.error === 'DeviceNotRegistered') {
          // Remove invalid token
          await users.updateOne(
            { firebaseUid: recipientId },
            { $unset: { pushToken: '', platform: '' } }
          )
          console.log('🗑️ Removed invalid push token for user:', recipientId)
        }
        return false
      }
    }

    console.log('✅ Push notification sent successfully to:', recipientId)
    return true
  } catch (error) {
    console.error('❌ Send call notification error:', error)
    return false
  }
}

/**
 * Send push notification for call ended
 * @param {string} recipientId - Firebase UID of the recipient
 * @param {string} callerName - Name of the caller
 * @param {number} duration - Call duration in seconds
 */
async function sendCallEndedNotification(recipientId, callerName, duration) {
  try {
    const { users } = getCollections()
    const recipient = await users.findOne({ firebaseUid: recipientId })

    if (!recipient?.pushToken || !Expo.isExpoPushToken(recipient.pushToken)) {
      return false
    }

    const message = {
      to: recipient.pushToken,
      sound: 'default',
      title: 'Call Ended',
      body: `Call with ${callerName} ended (${formatDuration(duration)})`,
      data: {
        type: 'call_ended',
        duration,
      },
      priority: 'default',
    }

    const chunks = expo.chunkPushNotifications([message])
    for (let chunk of chunks) {
      await expo.sendPushNotificationsAsync(chunk)
    }

    return true
  } catch (error) {
    console.error('❌ Send call ended notification error:', error)
    return false
  }
}

/**
 * Send push notification for missed call
 * @param {string} recipientId - Firebase UID of the recipient
 * @param {string} callerName - Name of the caller
 * @param {string} callType - 'voice' or 'video'
 */
async function sendMissedCallNotification(recipientId, callerName, callType) {
  try {
    const { users } = getCollections()
    const recipient = await users.findOne({ firebaseUid: recipientId })

    if (!recipient?.pushToken || !Expo.isExpoPushToken(recipient.pushToken)) {
      return false
    }

    const message = {
      to: recipient.pushToken,
      sound: 'default',
      title: 'Missed Call',
      body: `Missed ${callType} call from ${callerName}`,
      data: {
        type: 'missed_call',
        callerName,
        callType,
      },
      priority: 'high',
      badge: 1,
    }

    const chunks = expo.chunkPushNotifications([message])
    for (let chunk of chunks) {
      await expo.sendPushNotificationsAsync(chunk)
    }

    return true
  } catch (error) {
    console.error('❌ Send missed call notification error:', error)
    return false
  }
}

/**
 * Format call duration
 * @param {number} seconds - Duration in seconds
 * @returns {string} - Formatted duration
 */
function formatDuration(seconds) {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}m ${secs}s`
}

/**
 * Check push notification receipts
 * @param {array} receiptIds - Array of receipt IDs to check
 */
async function checkPushNotificationReceipts(receiptIds) {
  try {
    const receipts = await expo.getPushNotificationReceiptsAsync(receiptIds)

    for (let receiptId in receipts) {
      const receipt = receipts[receiptId]

      if (receipt.status === 'error') {
        console.error('❌ Push notification receipt error:', {
          receiptId,
          message: receipt.message,
          details: receipt.details,
        })

        // Handle DeviceNotRegistered error
        if (receipt.details?.error === 'DeviceNotRegistered') {
          console.log('🗑️ Device not registered, should remove token')
        }
      } else if (receipt.status === 'ok') {
        console.log('✅ Push notification delivered:', receiptId)
      }
    }
  } catch (error) {
    console.error('❌ Error checking receipts:', error)
  }
}

module.exports = {
  sendCallNotification,
  sendCallEndedNotification,
  sendMissedCallNotification,
  checkPushNotificationReceipts,
}
