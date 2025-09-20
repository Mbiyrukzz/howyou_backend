const admin = require('firebase-admin')

const verifyAuthToken = async (req, res, next) => {
  try {
    // Check for Authorization header first (standard Bearer format)
    const authHeader = req.headers.authorization
    let token = null

    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split('Bearer ')[1]
    } else if (req.headers.authtoken) {
      // Fallback to custom authtoken header
      token = req.headers.authtoken
    }

    console.log(
      '🔐 Received token:',
      token ? token.substring(0, 20) + '...' : 'none'
    )

    if (!token) {
      console.log('❌ No auth token provided')
      return res.status(401).json({ error: 'No auth token provided' })
    }

    const decodedToken = await admin.auth().verifyIdToken(token)
    console.log('✅ Token verified for user:', decodedToken.uid)

    req.user = decodedToken
    next()
  } catch (error) {
    console.error('❌ Error verifying token:', error.message)
    res.status(401).json({ error: 'Unauthorized' })
  }
}

module.exports = { verifyAuthToken }
