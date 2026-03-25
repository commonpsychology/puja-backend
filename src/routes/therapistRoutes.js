const express = require('express')
const router  = express.Router()

const { authenticate }               = require('../middleware/auth')
// Path is correct: this file lives at src/routes/therapistRoutes.js
// adminController lives at      src/routes/controllers/adminController.js
const { getMyTherapistAppointments } = require('./controllers/adminController')

const { getAppointmentNote, upsertAppointmentNote } = require('./controllers/communityController')
 
// All therapist-portal routes require a valid JWT
router.use(authenticate)

// GET /api/therapist-portal/appointments
router.get('/appointments', getMyTherapistAppointments)

router.get('/appointments/:id/notes',  getAppointmentNote)
router.put('/appointments/:id/notes',  upsertAppointmentNote)
 

module.exports = router