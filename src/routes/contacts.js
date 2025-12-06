const { getCollections } = require('../db')
const { verifyAuthToken } = require('../middleware/verifyAuthToken')

const addContactRoute = {
  path: '/contacts/add',
  method: 'post',
  middleware: [verifyAuthToken],
  handler: async (req, res) => {
    try {
      const { phoneNumber, email, name } = req.body
      const currentUserId = req.user.uid

      console.log('🔵 [Backend] Add contact request:', {
        currentUserId,
        phoneNumber,
        email,
        name,
      })

      if (!phoneNumber && !email) {
        return res.status(400).json({
          success: false,
          error: 'Phone number or email is required',
        })
      }

      const { users, contacts } = getCollections()

      // Search for user by phone or email
      const query = []
      if (phoneNumber) {
        console.log('🔍 Searching by phone:', phoneNumber)
        query.push({ phoneNumber: phoneNumber.trim() })
      }
      if (email) {
        console.log('🔍 Searching by email:', email.toLowerCase())
        query.push({ email: email.toLowerCase().trim() })
      }

      const foundUser = await users.findOne({ $or: query })

      console.log('🔍 Found user:', foundUser ? foundUser.firebaseUid : 'None')

      if (!foundUser) {
        // User doesn't exist - return info to send invite
        console.log('❌ User not found')
        return res.json({
          success: false,
          userExists: false,
          message: 'User not found',
          inviteData: {
            phoneNumber,
            email,
            name: name || 'Friend',
          },
        })
      }

      // Don't allow adding yourself
      if (foundUser.firebaseUid === currentUserId) {
        console.log('❌ Cannot add yourself')
        return res.status(400).json({
          success: false,
          error: 'Cannot add yourself as a contact',
        })
      }

      // Check if contact already exists
      const existingContact = await contacts.findOne({
        userId: currentUserId,
        contactUserId: foundUser.firebaseUid,
      })

      if (existingContact) {
        console.log('⚠️ Contact already exists')
        return res.json({
          success: false,
          error: 'Contact already exists',
          contact: {
            ...existingContact,
            userDetails: {
              firebaseUid: foundUser.firebaseUid,
              name: foundUser.name,
              email: foundUser.email,
              phoneNumber: foundUser.phoneNumber,
              photoURL: foundUser.photoURL,
              online: foundUser.online || false,
            },
          },
        })
      }

      // Create contact
      const newContact = {
        userId: currentUserId,
        contactUserId: foundUser.firebaseUid,
        contactName:
          name || foundUser.name || foundUser.displayName || 'Contact',
        addedAt: new Date(),
        favorite: false,
      }

      console.log('➕ Creating new contact:', newContact)

      const result = await contacts.insertOne(newContact)

      // Also create reverse contact (mutual)
      const reverseContact = {
        userId: foundUser.firebaseUid,
        contactUserId: currentUserId,
        contactName: req.user.displayName || req.user.email || 'Contact',
        addedAt: new Date(),
        favorite: false,
      }

      console.log('➕ Creating reverse contact:', reverseContact)

      await contacts.insertOne(reverseContact)

      console.log('✅ Contact added successfully:', foundUser.firebaseUid)

      // Notify the other user via WebSocket
      const wsClients = req.app.get('wsClients')
      if (wsClients) {
        const client = wsClients.get(foundUser.firebaseUid)
        if (client?.ws.readyState === 1) {
          client.ws.send(
            JSON.stringify({
              type: 'new-contact',
              contactId: currentUserId,
              contactName: req.user.displayName || req.user.email,
              timestamp: new Date().toISOString(),
            })
          )
        }
      }

      res.json({
        success: true,
        userExists: true,
        contact: {
          ...newContact,
          _id: result.insertedId,
          userDetails: {
            firebaseUid: foundUser.firebaseUid,
            name: foundUser.name,
            email: foundUser.email,
            phoneNumber: foundUser.phoneNumber,
            photoURL: foundUser.photoURL,
            online: foundUser.online || false,
            lastSeen: foundUser.lastSeen,
          },
        },
      })
    } catch (err) {
      console.error('❌ Error adding contact:', err)
      res.status(500).json({
        success: false,
        error: 'Failed to add contact',
        details: err.message,
      })
    }
  },
}

// Get all contacts for current user
const getContactsRoute = {
  path: '/contacts',
  method: 'get',
  middleware: [verifyAuthToken],
  handler: async (req, res) => {
    try {
      const currentUserId = req.user.uid
      const { users, contacts } = getCollections()

      console.log('📥 [Backend] Fetching contacts for:', currentUserId)

      // Get all contacts
      const userContacts = await contacts
        .find({ userId: currentUserId })
        .toArray()

      console.log('📥 [Backend] Found contacts:', userContacts.length)

      // Fetch full user details for each contact
      const contactsWithDetails = await Promise.all(
        userContacts.map(async (contact) => {
          const contactUser = await users.findOne({
            firebaseUid: contact.contactUserId,
          })

          return {
            ...contact,
            userDetails: contactUser
              ? {
                  firebaseUid: contactUser.firebaseUid,
                  name: contactUser.name,
                  email: contactUser.email,
                  phoneNumber: contactUser.phoneNumber,
                  photoURL: contactUser.photoURL,
                  online: contactUser.online || false,
                  lastSeen: contactUser.lastSeen,
                }
              : null,
          }
        })
      )

      res.json({
        success: true,
        contacts: contactsWithDetails,
      })
    } catch (err) {
      console.error('❌ Error fetching contacts:', err)
      res.status(500).json({
        success: false,
        error: 'Failed to fetch contacts',
      })
    }
  },
}

// Remove contact
const removeContactRoute = {
  path: '/contacts/:contactId',
  method: 'delete',
  middleware: [verifyAuthToken],
  handler: async (req, res) => {
    try {
      const { contactId } = req.params
      const currentUserId = req.user.uid
      const { contacts } = getCollections()

      console.log('🗑️ [Backend] Removing contact:', {
        currentUserId,
        contactId,
      })

      // Remove contact
      const result = await contacts.deleteOne({
        userId: currentUserId,
        contactUserId: contactId,
      })

      if (result.deletedCount === 0) {
        return res.status(404).json({
          success: false,
          error: 'Contact not found',
        })
      }

      // Also remove reverse contact
      await contacts.deleteOne({
        userId: contactId,
        contactUserId: currentUserId,
      })

      console.log('✅ Contact removed:', contactId)

      res.json({
        success: true,
        message: 'Contact removed successfully',
      })
    } catch (err) {
      console.error('❌ Error removing contact:', err)
      res.status(500).json({
        success: false,
        error: 'Failed to remove contact',
      })
    }
  },
}

// Search users (only for adding contacts)
const searchUsersRoute = {
  path: '/contacts/search',
  method: 'post',
  middleware: [verifyAuthToken],
  handler: async (req, res) => {
    try {
      const { query } = req.body
      const currentUserId = req.user.uid

      console.log('🔍 [Backend] Search request:', { currentUserId, query })

      if (!query || query.length < 2) {
        return res.status(400).json({
          success: false,
          error: 'Search query must be at least 2 characters',
        })
      }

      const { users, contacts } = getCollections()

      // Search by name, email, or phone
      const searchResults = await users
        .find({
          $and: [
            { firebaseUid: { $ne: currentUserId } }, // Exclude self
            {
              $or: [
                { name: { $regex: query, $options: 'i' } },
                { email: { $regex: query, $options: 'i' } },
                { phoneNumber: { $regex: query, $options: 'i' } },
              ],
            },
          ],
        })
        .limit(20)
        .toArray()

      console.log('🔍 [Backend] Search found:', searchResults.length, 'users')

      // Get user's existing contacts
      const existingContacts = await contacts
        .find({ userId: currentUserId })
        .toArray()

      const contactIds = new Set(existingContacts.map((c) => c.contactUserId))

      // Mark users as already contacts
      const resultsWithStatus = searchResults.map((user) => ({
        firebaseUid: user.firebaseUid,
        name: user.name,
        email: user.email,
        phoneNumber: user.phoneNumber,
        photoURL: user.photoURL,
        online: user.online || false,
        isContact: contactIds.has(user.firebaseUid),
      }))

      res.json({
        success: true,
        users: resultsWithStatus,
      })
    } catch (err) {
      console.error('❌ Error searching users:', err)
      res.status(500).json({
        success: false,
        error: 'Failed to search users',
      })
    }
  },
}

// Toggle favorite contact
const toggleFavoriteRoute = {
  path: '/contacts/:contactId/favorite',
  method: 'put',
  middleware: [verifyAuthToken],
  handler: async (req, res) => {
    try {
      const { contactId } = req.params
      const currentUserId = req.user.uid
      const { contacts } = getCollections()

      const contact = await contacts.findOne({
        userId: currentUserId,
        contactUserId: contactId,
      })

      if (!contact) {
        return res.status(404).json({
          success: false,
          error: 'Contact not found',
        })
      }

      await contacts.updateOne(
        { userId: currentUserId, contactUserId: contactId },
        { $set: { favorite: !contact.favorite } }
      )

      res.json({
        success: true,
        favorite: !contact.favorite,
      })
    } catch (err) {
      console.error('❌ Error toggling favorite:', err)
      res.status(500).json({
        success: false,
        error: 'Failed to toggle favorite',
      })
    }
  },
}

module.exports = {
  addContactRoute,
  getContactsRoute,
  removeContactRoute,
  searchUsersRoute,
  toggleFavoriteRoute,
}
