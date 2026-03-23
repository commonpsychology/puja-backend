const express = require('express')
const { authenticate } = require('../middleware/auth')
const {
  bookAppointment,
  listMyAppointments,
  getAppointment,
  cancelAppointment,
  rescheduleAppointment,
} = require('./controllers/appointmentController')

const router = express.Router()

router.use(authenticate)

router.post('/',          bookAppointment)
router.get('/',           listMyAppointments)
router.get('/:id',        getAppointment)
router.patch('/:id/cancel',     cancelAppointment)
router.patch('/:id/reschedule', rescheduleAppointment)

module.exports = router