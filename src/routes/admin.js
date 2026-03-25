// src/routes/admin.js
const express = require('express')
const { authenticate } = require('../middleware/auth')
const {
  getDashboard,
  getUsers, toggleUserActive, setUserActive, setUserStatus, setUserRole,
  getAllAppointments, setAppointmentStatus,
  getAllOrders, setOrderStatus, sendNotificationToClient,
  getAllPayments,
  createProduct, updateProduct, deleteProduct,
  registerStaff,
} = require('./controllers/adminController')   // ✅ fixed path

const {
  adminListGroups, adminCreateGroup, adminToggleGroup,
  adminListSessions, adminCreateSession,
  adminListPosts, adminModeratePost, adminDeletePost,
  adminListReservations,
} = require('./controllers/communityController') // ✅ correct

const router = express.Router()

router.use(authenticate)

// Dashboard
router.get('/dashboard',                       getDashboard)

// Users
router.get('/users',                           getUsers)
router.patch('/users/:id/toggle-active',       toggleUserActive)
router.patch('/users/:id/status',              setUserStatus)
router.patch('/users/:id/role',                setUserRole)

// Notifications
router.post('/notifications',                  sendNotificationToClient)

// Appointments
router.get('/appointments',                    getAllAppointments)
router.patch('/appointments/:id/status',       setAppointmentStatus)

// Orders
router.get('/orders',                          getAllOrders)
router.patch('/orders/:id/status',             setOrderStatus)

// Payments
router.get('/payments',                        getAllPayments)

// Products
router.post('/products',                       createProduct)
router.patch('/products/:id',                  updateProduct)
router.delete('/products/:id',                 deleteProduct)

// Staff
router.post('/register-staff',                 registerStaff)

// Community — Groups
router.get('/community/groups',                adminListGroups)
router.post('/community/groups',               adminCreateGroup)
router.patch('/community/groups/:id/toggle',   adminToggleGroup)

// Community — Sessions
router.get('/community/sessions',              adminListSessions)
router.post('/community/sessions',             adminCreateSession)

// Community — Posts
router.get('/community/posts',                 adminListPosts)
router.patch('/community/posts/:id/moderate',  adminModeratePost)
router.delete('/community/posts/:id',          adminDeletePost)

// Community — Reservations
router.get('/community/reservations',          adminListReservations)

module.exports = router  // ✅ moved to bottom