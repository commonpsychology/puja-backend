// src/routes/volunteerRoutes.js
const express = require('express')
const router  = express.Router()

const {
  submitVolunteer,
  getVolunteerApplications,
  getVolunteerApplication,
  updateVolunteerApplication,
  deleteVolunteerApplication,
} = require('./controllers/volunteerGalleryController')

// Public
router.post('/', submitVolunteer)

// Admin
router.get('/',      getVolunteerApplications)
router.get('/:id',   getVolunteerApplication)
router.patch('/:id', updateVolunteerApplication)
router.delete('/:id',deleteVolunteerApplication)

module.exports = router