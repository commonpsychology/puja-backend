// integrateRoutes.js
const express = require('express')
const { createIntegration, listIntegrations } = require('./integrateController')

const router = express.Router()

// Public: anyone can submit the membership form
router.post('/api/integrate', createIntegration)

// Admin-only: add your auth middleware in front of this in production, e.g.
//   router.get('/api/integrate', requireAdmin, listIntegrations)
router.get('/api/integrate', listIntegrations)

module.exports = router

// --- wiring it up in your server entry point (e.g. server.js) ---
//
//   const express = require('express')
//   const integrateRoutes = require('./integrateRoutes')
//
//   const app = express()
//   app.use(express.json())
//   app.use(integrateRoutes)
//
//   app.listen(process.env.PORT || 3001)