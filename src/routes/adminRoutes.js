// src/routes/adminRoutes.js  (or wherever your admin routes are defined)
const express = require('express')
const { authenticate, requireRole } = require('../middleware/auth')
const {
  getDashboard,
  getUsers, toggleUserActive, setUserStatus, setUserRole,
  getAllAppointments, setAppointmentStatus,
  getAllOrders, setOrderStatus,
  getAllPayments,
  createProduct, updateProduct, deleteProduct,
} = require('../controllers/adminController')

const router = express.Router()

// All admin routes require authentication + admin or staff role
router.use(authenticate)
router.use(requireRole(['admin', 'staff']))

// Dashboard
router.get('/dashboard', getDashboard)

// Users
router.get('/users',                    getUsers)
router.patch('/users/:id/toggle-active', toggleUserActive)   // ← used by frontend toggleActive()
router.patch('/users/:id/status',        setUserStatus)
router.patch('/users/:id/role',          setUserRole)

// Appointments
router.get('/appointments',             getAllAppointments)
router.patch('/appointments/:id/status', setAppointmentStatus)

// Orders
router.get('/orders',                   getAllOrders)
router.patch('/orders/:id/status',       setOrderStatus)

// Payments
router.get('/payments',                 getAllPayments)

// Products
router.post('/products',                createProduct)
router.patch('/products/:id',            updateProduct)
router.delete('/products/:id',           deleteProduct)

module.exports = router