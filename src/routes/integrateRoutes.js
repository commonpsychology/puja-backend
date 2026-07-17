// integrateRoutes.js
const express = require('express')
const { createIntegration, listIntegrations } = require('./integrateController')

const router = express.Router()

// NOTE: paths here are relative — mount this router the same way you mount
// your existing auth routes, so the frontend's `${API_BASE}/integrate` call
// lines up. If auth routes are e.g. `app.use('/api/auth', authRoutes)` with
// `router.post('/login', ...)` inside, do the equivalent here:
//   app.use('/api', integrateRoutes)   // → POST /api/integrate

// Public: anyone can submit the membership form
router.post('/integrate', createIntegration)

// Admin-only: add your auth middleware in front of this in production, e.g.
//   router.get('/integrate', requireAdmin, listIntegrations)
router.get('/integrate', listIntegrations)

module.exports = router

// --- wiring it up in your server entry point (e.g. server.js), matching
//     however auth.routes.js is already mounted there ---
//
//   const integrateRoutes = require('./integrateRoutes')
//   app.use('/api', integrateRoutes)