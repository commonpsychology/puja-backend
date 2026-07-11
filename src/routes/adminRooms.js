const express = require('express')
const router  = express.Router()
const { authenticate, requireRole } = require('../middleware/auth') // ⚠️ same check as above

const {
  adminListRooms,
  adminCreateRoom,
  adminUpdateRoom,
  adminDeleteRoom,
} = require('./controllers/roomBookingController')

router.use(authenticate, requireRole(['admin', 'staff']))

router.get   ('/',     adminListRooms)
router.post  ('/',     adminCreateRoom)
router.put   ('/:id',  adminUpdateRoom)
router.delete('/:id',  adminDeleteRoom)

module.exports = router