// src/routes/researchRoute.js
const express  = require('express')
const router   = express.Router()
const ctrl     = require('./controllers/research_Controller')
const { protect, isAdmin } = require('../middleware/auth')
const { supabase } = require('../db/supabase') // ← import your supabase client

router.get('/:id/pdf', ctrl.proxyPdf)   
// ── Public ────────────────────────────────────────────────────
router.get('/',       ctrl.getPapers)
router.get('/types',  ctrl.getTypes)   // static BEFORE /:id
router.get('/stats',  ctrl.getStats)   // static BEFORE /:id

// POST /api/research/:id/download  ← MUST be before /:id GET
router.post('/:id/download', async (req, res) => {
  try {
    const { id } = req.params
    const { data: newDownloads, error } = await supabase
      .rpc('increment_research_downloads', { research_id: id })
    if (error) throw error
    res.json({ ok: true, downloads: newDownloads })
  } catch (e) {
    res.status(500).json({ ok: false, message: e.message })
  }
})

router.get('/:id', ctrl.getPaperById)

// ── Admin ─────────────────────────────────────────────────────
router.post('/',    protect, isAdmin, ctrl.createPaper)
router.put('/:id',  protect, isAdmin, ctrl.updatePaper)
router.delete('/:id', protect, isAdmin, ctrl.deletePaper)

module.exports = router