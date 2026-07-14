const bcrypt = require('bcryptjs')
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

function safe(rider) {
  if (!rider) return rider
  const { password_hash, ...rest } = rider
  return { ...rest, has_password: !!password_hash }
}

// ---------- GET /api/admin/delivery-riders ----------
exports.list = async (req, res) => {
  try {
    const page  = Math.max(1, Number(req.query.page) || 1)
    const limit = Math.min(100, Number(req.query.limit) || 50)
    const from  = (page - 1) * limit
    const to    = from + limit - 1

    let query = supabase.from('delivery_riders').select('*', { count: 'exact' })
    if (req.query.search) query = query.ilike('full_name', `%${req.query.search}%`)
    if (req.query.is_active !== undefined && req.query.is_active !== '') {
      query = query.eq('is_active', req.query.is_active === 'true')
    }
    query = query.order('created_at', { ascending: false }).range(from, to)

    const { data, error, count } = await query
    if (error) throw error

    // attach live delivery counts (optional nicety)
    const riders = data || []
    const ids = riders.map(r => r.id)
    let counts = {}
    if (ids.length) {
      const { data: orderRows } = await supabase
        .from('orders').select('delivery_rider_id, delivery_status').in('delivery_rider_id', ids)
      ;(orderRows || []).forEach(o => {
        counts[o.delivery_rider_id] = counts[o.delivery_rider_id] || { active: 0, delivered: 0 }
        if (o.delivery_status === 'delivered') counts[o.delivery_rider_id].delivered++
        else if (!['unassigned','failed','returned'].includes(o.delivery_status)) counts[o.delivery_rider_id].active++
      })
    }

    const items = riders.map(r => ({ ...safe(r), stats: counts[r.id] || { active: 0, delivered: 0 } }))
    res.json({ riders: items, pagination: { total: count || 0, page, limit } })
  } catch (e) { res.status(500).json({ message: e.message }) }
}

// ---------- POST /api/admin/delivery-riders ----------
exports.create = async (req, res) => {
  try {
    const { full_name, phone, email, area, vehicle_type, password, is_active } = req.body
    if (!full_name?.trim()) return res.status(400).json({ message: 'Full name is required' })
    if (!phone?.trim()) return res.status(400).json({ message: 'Phone is required' })
    if (!password || password.length < 6) return res.status(400).json({ message: 'Password must be at least 6 characters' })

    const password_hash = await bcrypt.hash(password, 10)
    const { data, error } = await supabase.from('delivery_riders').insert({
      full_name: full_name.trim(),
      phone: phone.trim(),
      email: email?.trim() || null,
      area: area?.trim() || null,
      vehicle_type: vehicle_type || null,
      is_active: is_active !== false,
      password_hash,
    }).select().single()

    if (error) {
      if (error.code === '23505') return res.status(409).json({ message: 'A rider with this phone or email already exists' })
      throw error
    }
    res.json({ rider: safe(data) })
  } catch (e) { res.status(500).json({ message: e.message }) }
}

// ---------- PUT /api/admin/delivery-riders/:id ----------
exports.update = async (req, res) => {
  try {
    const { full_name, phone, email, area, vehicle_type, is_active } = req.body
    const body = {}
    if (full_name !== undefined) body.full_name = full_name.trim()
    if (phone !== undefined) body.phone = phone.trim()
    if (email !== undefined) body.email = email?.trim() || null
    if (area !== undefined) body.area = area?.trim() || null
    if (vehicle_type !== undefined) body.vehicle_type = vehicle_type || null
    if (is_active !== undefined) body.is_active = is_active

    const { data, error } = await supabase.from('delivery_riders').update(body).eq('id', req.params.id).select().single()
    if (error) {
      if (error.code === '23505') return res.status(409).json({ message: 'A rider with this phone or email already exists' })
      throw error
    }
    res.json({ rider: safe(data) })
  } catch (e) { res.status(500).json({ message: e.message }) }
}

// ---------- DELETE /api/admin/delivery-riders/:id (soft delete) ----------
exports.remove = async (req, res) => {
  try {
    // Unassign any open orders first so nothing gets stuck on a deactivated rider
    await supabase.from('orders')
      .update({ delivery_rider_id: null })
      .eq('delivery_rider_id', req.params.id)
      .not('delivery_status', 'in', '(delivered,failed,returned)')

    const { error } = await supabase.from('delivery_riders').update({ is_active: false }).eq('id', req.params.id)
    if (error) throw error
    res.json({ success: true })
  } catch (e) { res.status(500).json({ message: e.message }) }
}

// ---------- POST /api/admin/delivery-riders/:id/set-password ----------
exports.setPassword = async (req, res) => {
  try {
    const { password } = req.body
    if (!password || password.length < 6) return res.status(400).json({ message: 'Password must be at least 6 characters' })

    const password_hash = await bcrypt.hash(password, 10)
    const { error } = await supabase.from('delivery_riders').update({ password_hash }).eq('id', req.params.id)
    if (error) throw error
    res.json({ success: true })
  } catch (e) { res.status(500).json({ message: e.message }) }
}