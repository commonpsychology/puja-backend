const express = require('express')
const { authenticate } = require('../middleware/auth')
const {
  listTherapists,
  getTherapist,
  getTherapistAvailability,
  searchTherapists,
} = require('./controllers/therapistController')

const router = express.Router()

router.get('/',                       listTherapists)
router.get('/search',                 searchTherapists)
router.get('/:id',                    getTherapist)
router.get('/:id/availability',       getTherapistAvailability)

module.exports = router