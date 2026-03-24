// src/routes/admin.js  ← this is what index.js loads via require('./routes/admin')
const express = require('express')
const { authenticate } = require('../middleware/auth')
const {
  getDashboard,
  getUsers, toggleUserActive, setUserStatus, setUserRole,
  getAllAppointments, setAppointmentStatus,
  getAllOrders, setOrderStatus,sendNotificationToClient,
  getAllPayments,
  createProduct, updateProduct, deleteProduct,
} = require('./controllers/adminController')

const router = express.Router()

// All admin routes require authentication
router.use(authenticate)

// Dashboard
router.get('/dashboard',                getDashboard)

// Users
router.get('/users',                    getUsers)
router.patch('/users/:id/toggle-active', toggleUserActive)
router.patch('/users/:id/status',        setUserStatus)
router.patch('/users/:id/role',          setUserRole)

//notifications
router.post('/notifications', sendNotificationToClient)

// Appointments
router.get('/appointments',              getAllAppointments)
router.patch('/appointments/:id/status', setAppointmentStatus)

// Orders
router.get('/orders',                    getAllOrders)
router.patch('/orders/:id/status',       setOrderStatus)

// Payments
router.get('/payments',                  getAllPayments)

// Products
router.post('/products',                 createProduct)
router.patch('/products/:id',            updateProduct)
router.delete('/products/:id',           deleteProduct)

module.exports = router