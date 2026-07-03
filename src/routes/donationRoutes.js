// src/routes/donationRoutes.js
const express = require('express');
const router = express.Router();
const { createDonation, getDonationStats } = require('./controllers/donationController');

// Record a successful donation (call from your payment webhook)
router.post('/', createDonation);

// Public aggregate stats for the homepage widget
router.get('/stats', getDonationStats);

module.exports = router;

// In your main app.js / server.js, mount it with:
//   const donationRoutes = require('./routes/donationRoutes');
//   app.use('/api/donations', donationRoutes);