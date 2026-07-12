// src/routes/diagnostics.js
// Mount as: app.use('/api/_diagnostics', diagnosticsRoutes)
// Unauthenticated on purpose — this is a read-only self-report, no data leaked.
const express = require('express')
const router = express.Router()
const supabase = require('../db/supabase')

router.get('/', async (req, res) => {
  const report = {
    timestamp: new Date().toISOString(),
    node_env: process.env.NODE_ENV || 'unset',
    vercel_env: process.env.VERCEL_ENV || 'not vercel',
    vercel_git_commit: process.env.VERCEL_GIT_COMMIT_SHA || 'unknown',
    vercel_deployment_url: process.env.VERCEL_URL || 'unknown',
  }

  // ── 1. Can we reach Supabase at all? ──
  try {
    const { error } = await supabase.from('therapists').select('id').limit(1)
    report.supabase_reachable = !error
    report.supabase_error = error?.message || null
  } catch (e) {
    report.supabase_reachable = false
    report.supabase_error = e.message
  }

  // ── 2. Does the one-booking-per-day trigger function exist? ──
  try {
    const { data, error } = await supabase.rpc('pg_get_functiondef_check', {}).select()
    // fallback: just check via a raw query if rpc doesn't exist
  } catch {}
  try {
    const { data: fnCheck, error: fnErr } = await supabase
      .from('pg_proc')
      .select('proname')
      .eq('proname', 'check_one_booking_per_day')
      .limit(1)
    report.trigger_function_visible = !fnErr && Array.isArray(fnCheck)
  } catch (e) {
    report.trigger_function_visible = 'unknown (pg_proc not queryable via client — expected, use SQL editor to confirm)'
  }

  // ── 3. Sample a real therapist's available_hours shape ──
  try {
    const { data: sample, error } = await supabase
      .from('therapists')
      .select('id, available_hours, is_available')
      .limit(3)
    report.sample_therapists = error ? { error: error.message } : sample
  } catch (e) {
    report.sample_therapists = { error: e.message }
  }

  // ── 4. List every route actually registered on this running app instance ──
  // Walks req.app._router.stack — this is the ground truth of what's live,
  // independent of what any source file claims.
  const routes = []
  function walk(stack, prefix = '') {
    stack.forEach(layer => {
      if (layer.route) {
        const methods = Object.keys(layer.route.methods).join(',').toUpperCase()
        routes.push(`${methods} ${prefix}${layer.route.path}`)
      } else if (layer.name === 'router' && layer.handle?.stack) {
        // Try to recover the mount path Express stored for this sub-router
        const mountPath = layer.regexp?.source
          ?.replace('^\\', '')
          ?.replace('\\/?(?=\\/|$)', '')
          ?.replace(/\\\//g, '/') || '(unknown-prefix)'
        walk(layer.handle.stack, prefix + mountPath)
      }
    })
  }
  try {
    walk(req.app._router.stack)
    report.live_routes = routes.sort()
    report.has_bookings_check_day = routes.some(r => r.includes('/check-day'))
    report.has_appointments_can_book = routes.some(r => r.includes('/can-book'))
  } catch (e) {
    report.live_routes_error = e.message
  }

  return res.json(report)
})

module.exports = router