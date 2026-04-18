// src/routes/resourcesRoute.js
const express = require('express')
const router  = express.Router()
const ctrl    = require('./controllers/resources_Controller')
const { protect, isAdmin } = require('../middleware/auth')

// ── Legal docs (public, no auth) ──────────────────────────────
// IMPORTANT: these must come BEFORE /:id routes to avoid conflicts
router.get('/legal',                ctrl.getLegalDocs)
router.get('/legal/:id/view',       ctrl.viewLegalDoc)
router.get('/legal/:id/download',   ctrl.downloadLegalDoc)

// ── Public ────────────────────────────────────────────────────
router.get('/',                     ctrl.getResources)
router.get('/categories',           ctrl.getCategories)
router.get('/:id/download', ctrl.recordDownload)

// ── Admin ─────────────────────────────────────────────────────
router.post('/',        protect, isAdmin, ctrl.createResource)
router.put('/:id',      protect, isAdmin, ctrl.updateResource)
router.delete('/:id',   protect, isAdmin, ctrl.deleteResource)

module.exports = router