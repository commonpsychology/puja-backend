// src/routes/payments.js
const express          = require('express')
const { authenticate } = require('../middleware/auth')
const {
  initiatePayment,
  verifyPayment,
  validateCoupon,
  getMyPayments,
  getMyOrders,
  getPaymentById,
  getAllPaymentsAdmin,
  approvePayment,
  rejectPayment,
  confirmCOD,
  flagCOD,
} = require('./controllers/paymentConfirmationController')

const router = express.Router()

const adminOnly = (req, res, next) => {
  if (!req.user) return res.status(401).json({ success: false, message: 'Not authenticated.' })
  if (!['admin', 'staff'].includes(req.user.role))
    return res.status(403).json({ success: false, message: 'Admin or staff access required.' })
  next()
}

router.use(authenticate)

// Admin routes
router.get('/admin/all',              adminOnly, getAllPaymentsAdmin)
router.post('/admin/:id/approve',     adminOnly, approvePayment)
router.post('/admin/:id/reject',      adminOnly, rejectPayment)
router.post('/admin/:id/cod-confirm', adminOnly, confirmCOD)
router.post('/admin/:id/cod-flag',    adminOnly, flagCOD)

// Coupon validation (used by PaymentModal before confirming)
router.post('/coupons/validate', validateCoupon)

// Client routes
router.post('/initiate',  initiatePayment)
router.post('/',          initiatePayment)
router.post('/verify',    verifyPayment)
router.get('/my-orders',  getMyOrders)
router.get('/',           getMyPayments)
router.get('/:id',        getPaymentById)

module.exports = router