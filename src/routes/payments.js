// src/routes/payments.js
const express = require('express')
const { authenticate } = require('../middleware/auth')
const {
  initiatePayment,
  verifyPayment,
  getMyPayments,
  getPaymentById,
} = require('./controllers/paymentController')

const router = express.Router()

router.use(authenticate)

router.post('/initiate', initiatePayment)   // ← PaymentPage calls this
router.post('/verify',   verifyPayment)     // ← PaymentPage calls this
router.get('/',          getMyPayments)
router.get('/:id',       getPaymentById)

module.exports = router