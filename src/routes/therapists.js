const express = require('express')
const { authenticate } = require('../middleware/auth')
const {
  listTherapists,
  getTherapist,
  getTherapistAvailability,
  searchTherapists,
  listTherapistReviews,
  createTherapistReview,
} = require('./controllers/therapistController')

const router = express.Router()

router.get('/',                 listTherapists)
router.get('/search',           searchTherapists)
router.get('/:id',              getTherapist)
router.get('/:id/availability', getTherapistAvailability)

// Reviews — reading is public, posting requires a logged-in user
router.get('/:id/reviews',  listTherapistReviews)
router.post('/:id/reviews', authenticate, createTherapistReview)

module.exports = router