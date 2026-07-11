const express = require('express')
const router  = express.Router()
const { authenticate, requireRole } = require('../middleware/auth') // ⚠️ verify this matches your actual export name

const {
  adminListBookings,
  adminGetBooking,
  adminUpdateBookingStatus,
} = require('./controllers/roomBookingController')

router.use(authenticate, requireRole(['admin', 'staff']))

router.get   ('/',           adminListBookings)
router.get   ('/:id',        adminGetBooking)
router.patch ('/:id/status', adminUpdateBookingStatus)

module.exports = router