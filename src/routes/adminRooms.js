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

const UUID_RE = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'

router.get   ('/',                 adminListRooms)
router.post  ('/',                 adminCreateRoom)
router.put   (`/:id(${UUID_RE})`,  adminUpdateRoom)
router.delete(`/:id(${UUID_RE})`,  adminDeleteRoom)

module.exports = router