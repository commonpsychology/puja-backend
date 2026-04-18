// src/routes/attendanceRoutes.js
const express  = require('express')
const router   = express.Router()
const { authenticate, requireRole } = require('../middleware/auth')

const {
  listEvents,
  registerAttendance,
  getEventAttendees,
  createEvent,
} = require('./controllers/attendanceController')

// ── Public routes (no auth needed) ──────────────────────────
router.get('/events',      listEvents)           // GET  /api/attendance/events
router.post('/register',   registerAttendance)   // POST /api/attendance/register

// ── Admin / staff only ───────────────────────────────────────
router.use(authenticate)
router.post('/events',              requireRole(['admin','staff']), createEvent)          // POST /api/attendance/events
router.get('/records/:eventId',     requireRole(['admin','staff','therapist']), getEventAttendees) // GET /api/attendance/records/:eventId

module.exports = router