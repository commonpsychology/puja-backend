const express = require('express')
const router  = express.Router()
const { authenticate, requireRole } = require('../middleware/auth') // ⚠️ verify this matches your actual export name

const {
  adminListBookings,
  adminGetBooking,
  adminUpdateBookingStatus,
} = require('./controllers/roomBookingController')

router.use(authenticate, requireRole(['admin', 'staff']))

const UUID_RE = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'

router.get   ('/',                       adminListBookings)
router.get   (`/:id(${UUID_RE})`,        adminGetBooking)
router.patch (`/:id(${UUID_RE})/status`, adminUpdateBookingStatus)

module.exports = router