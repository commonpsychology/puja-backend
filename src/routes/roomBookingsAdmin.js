
const express = require('express')
const router  = express.Router()
const ctrl    = require('./controllers/roomBookingController')
const { authenticate } = require('../../middleware/auth')

// Inline role gate — mirrors the role checks already used inline
// throughout adminController.js (req.user?.role)
function requireAdminOrStaff(req, res, next) {
  const role = req.user?.role
  if (!['admin', 'staff'].includes(role)) {
    return res.status(403).json({ success: false, message: 'Admin or staff access required.' })
  }
  next()
}

const adminOnly = [authenticate, requireAdminOrStaff]

// Rooms CRUD
router.get(   '/admin/rooms',        ...adminOnly, ctrl.adminListRooms)
router.post(  '/admin/rooms',        ...adminOnly, ctrl.adminCreateRoom)
router.put(   '/admin/rooms/:id',    ...adminOnly, ctrl.adminUpdateRoom)
router.delete('/admin/rooms/:id',    ...adminOnly, ctrl.adminDeleteRoom)

// Bookings
router.get(   '/admin/room-bookings',            ...adminOnly, ctrl.adminListBookings)
router.get(   '/admin/room-bookings/seat-map',   ...adminOnly, ctrl.adminSeatMap)
router.get(   '/admin/room-bookings/:id',        ...adminOnly, ctrl.adminGetBooking)
router.patch( '/admin/room-bookings/:id/status', ...adminOnly, ctrl.adminUpdateBookingStatus)
router.delete('/admin/room-bookings/:id',        ...adminOnly, ctrl.adminDeleteBooking)

module.exports = router