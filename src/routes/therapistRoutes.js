// src/routes/therapistRoutes.js
const express = require('express')
const router  = express.Router()
const { authenticate } = require('../middleware/auth')
const { getMyTherapistAppointments } = require('./controllers/adminController')

// Authenticate the user — role check is done inside the controller
router.use(authenticate)

router.get('/appointments', getMyTherapistAppointments)

module.exports = router