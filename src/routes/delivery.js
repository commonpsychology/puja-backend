const express = require('express')
const router = express.Router()
const ctrl = require('./controllers/deliveryController')
const { authenticateRider } = require('../middleware/deliveryAuth')

// 2FA login flow
router.post('/check-credentials', ctrl.checkCredentials)
router.post('/send-otp', ctrl.sendOtp)
router.post('/verify-otp', ctrl.verifyOtp)

// Legacy single-step login (kept for backward compatibility, not used by current frontend)
router.post('/login', ctrl.login)

router.get('/my-orders', authenticateRider, ctrl.myOrders)
router.put('/my-orders/:id', authenticateRider, ctrl.updateMyOrder)
router.put('/my-status', authenticateRider, ctrl.updateMyStatus)

module.exports = router