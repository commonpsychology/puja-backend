// ============================================================
// src/routes/patient.js
// ============================================================

const express        = require('express')
const router         = express.Router()
const { createClient } = require('@supabase/supabase-js')
const { authenticate: verifyToken } = require('../middleware/auth')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// ── GET /api/patients  — list all patients (newest first) ────
router.get('/', verifyToken, async (req, res) => {
  try {
    const { date, search, limit = 50, offset = 0 } = req.query

    let query = supabase
      .from('patients')
      .select('*', { count: 'exact' })
      .order('registered_at', { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1)

    if (date) {
      query = query
        .gte('registered_at', `${date}T00:00:00`)
        .lte('registered_at', `${date}T23:59:59`)
    }

    if (search) {
      query = query.or(`full_name.ilike.%${search}%,phone.ilike.%${search}%`)
    }

    const { data, error, count } = await query
    if (error) throw error

    res.json({ success: true, patients: data, total: count })
  } catch (err) {
    console.error('[patients GET /]', err)
    res.status(500).json({ success: false, message: err.message })
  }
})

// ── POST /api/patients  — register new patient ───────────────
router.post('/', verifyToken, async (req, res) => {
  try {
    const { full_name, date_of_birth, gender, address, phone, complaints } = req.body

    if (!full_name || !date_of_birth || !gender || !address || !complaints) {
      return res.status(400).json({ success: false, message: 'Missing required fields.' })
    }

    const { data, error } = await supabase
      .from('patients')
      .insert([{
        full_name,
        date_of_birth,
        gender,
        address,
        phone:         phone || null,
        complaints,
        registered_by: req.user?.id || null,
      }])
      .select()
      .single()

    if (error) throw error

    res.status(201).json({ success: true, patient: data })
  } catch (err) {
    console.error('[patients POST /]', err)
    res.status(500).json({ success: false, message: err.message })
  }
})

// ── GET /api/patients/:id  — single patient ──────────────────
router.get('/:id', verifyToken, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('patients')
      .select('*')
      .eq('id', req.params.id)
      .single()

    if (error || !data) return res.status(404).json({ success: false, message: 'Patient not found.' })
    res.json({ success: true, patient: data })
  } catch (err) {
    console.error('[patients GET /:id]', err)
    res.status(500).json({ success: false, message: err.message })
  }
})

// ── PATCH /api/patients/:id/status  — update status ─────────
router.patch('/:id/status', verifyToken, async (req, res) => {
  try {
    const { status } = req.body
    if (!['active', 'discharged', 'follow-up'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status. Must be active, discharged, or follow-up.' })
    }

    const { data, error } = await supabase
      .from('patients')
      .update({ status })
      .eq('id', req.params.id)
      .select()
      .single()

    if (error) throw error
    res.json({ success: true, patient: data })
  } catch (err) {
    console.error('[patients PATCH /:id/status]', err)
    res.status(500).json({ success: false, message: err.message })
  }
})

module.exports = router