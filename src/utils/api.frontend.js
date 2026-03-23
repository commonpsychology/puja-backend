/* eslint-disable no-undef */
const supabase = require('../db/supabase')

// ── GET /api/admin/dashboard ──────────────────────────────────
async function getDashboard(req, res, next) {
  try {
    const [
      { count: totalUsers },
      { count: totalAppointments },
      { count: pendingAppointments },
      { count: totalOrders },
      { data: recentPayments },
    ] = await Promise.all([
      supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('role', 'client'),
      supabase.from('appointments').select('*', { count: 'exact', head: true }),
      supabase.from('appointments').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
      supabase.from('orders').select('*', { count: 'exact', head: true }),
      supabase.from('payments').select('amount, status, created_at').eq('status', 'completed')
        .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
        .order('created_at', { ascending: false }).limit(5),
    ])

    const revenue30d = recentPayments?.reduce((s, p) => s + Number(p.amount), 0) || 0

    return res.status(200).json({
      success: true,
      stats: { totalUsers, totalAppointments, pendingAppointments, totalOrders, revenue30d },
      recentPayments,
    })
  } catch (err) { next(err) }
}

// ── GET /api/admin/users ──────────────────────────────────────
async function getUsers(req, res, next) {
  try {
    const { role, search, page = 1, limit = 20 } = req.query
    const offset = (Number(page) - 1) * Number(limit)

    let query = supabase
      .from('profiles')
      .select('id, full_name, email, phone, role, is_active, is_email_verified, created_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + Number(limit) - 1)

    if (role)   query = query.eq('role', role)
    if (search) query = query.or(`full_name.ilike.%${search}%,email.ilike.%${search}%`)

    const { data, count, error } = await query
    if (error) throw error

    return res.status(200).json({
      success: true, users: data,
      pagination: { page: Number(page), limit: Number(limit), total: count },
    })
  } catch (err) { next(err) }
}

// ── PATCH /api/admin/users/:id/status ────────────────────────
async function setUserStatus(req, res, next) {
  try {
    const { is_active } = req.body
    const { data, error } = await supabase
      .from('profiles').update({ is_active })
      .eq('id', req.params.id).select('id, full_name, email, is_active').single()
    if (error) throw error
    return res.status(200).json({ success: true, user: data })
  } catch (err) { next(err) }
}

// ── PATCH /api/admin/users/:id/role ──────────────────────────
async function setUserRole(req, res, next) {
  try {
    const { role } = req.body
    if (!['client','therapist','admin','staff'].includes(role))
      return res.status(400).json({ success: false, message: 'Invalid role.' })
    const { data, error } = await supabase
      .from('profiles').update({ role })
      .eq('id', req.params.id).select('id, full_name, email, role').single()
    if (error) throw error
    return res.status(200).json({ success: true, user: data })
  } catch (err) { next(err) }
}

// ── GET /api/admin/appointments ───────────────────────────────
async function getAllAppointments(req, res, next) {
  try {
    const { status, from, to, page = 1, limit = 20 } = req.query
    const offset = (Number(page) - 1) * Number(limit)

    let query = supabase
      .from('appointments')
      .select(`
        id, scheduled_at, type, status, duration_minutes, created_at,
        profiles!appointments_client_id_fkey ( full_name, email ),
        therapists ( profiles!therapists_user_id_fkey ( full_name ) )
      `, { count: 'exact' })
      .order('scheduled_at', { ascending: false })
      .range(offset, offset + Number(limit) - 1)

    if (status) query = query.eq('status', status)
    if (from)   query = query.gte('scheduled_at', from)
    if (to)     query = query.lte('scheduled_at', to)

    const { data, count, error } = await query
    if (error) throw error

    return res.status(200).json({
      success: true, appointments: data,
      pagination: { page: Number(page), limit: Number(limit), total: count },
    })
  } catch (err) { next(err) }
}

// ── PATCH /api/admin/appointments/:id/status ─────────────────
async function setAppointmentStatus(req, res, next) {
  try {
    const { status } = req.body
    const valid = ['pending','confirmed','cancelled','completed','no_show']
    if (!valid.includes(status))
      return res.status(400).json({ success: false, message: 'Invalid status.' })
    const { data, error } = await supabase
      .from('appointments').update({ status })
      .eq('id', req.params.id).select().single()
    if (error) throw error
    return res.status(200).json({ success: true, appointment: data })
  } catch (err) { next(err) }
}

// ── GET /api/admin/orders ─────────────────────────────────────
async function getAllOrders(req, res, next) {
  try {
    const { status, page = 1, limit = 20 } = req.query
    const offset = (Number(page) - 1) * Number(limit)

    let query = supabase
      .from('orders')
      .select(`
        id, order_number, status, total_amount, created_at,
        profiles!orders_client_id_fkey ( full_name, email )
      `, { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + Number(limit) - 1)

    if (status) query = query.eq('status', status)
    const { data, count, error } = await query
    if (error) throw error

    return res.status(200).json({
      success: true, orders: data,
      pagination: { page: Number(page), limit: Number(limit), total: count },
    })
  } catch (err) { next(err) }
}

// ── PATCH /api/admin/orders/:id/status ───────────────────────
async function setOrderStatus(req, res, next) {
  try {
    const { status } = req.body
    const { data, error } = await supabase
      .from('orders').update({ status })
      .eq('id', req.params.id).select().single()
    if (error) throw error
    return res.status(200).json({ success: true, order: data })
  } catch (err) { next(err) }
}

// ── POST /api/admin/products ──────────────────────────────────
async function createProduct(req, res, next) {
  try {
    const { data, error } = await supabase
      .from('products').insert(req.body).select().single()
    if (error) throw error
    return res.status(201).json({ success: true, product: data })
  } catch (err) { next(err) }
}

// ── PATCH /api/admin/products/:id ────────────────────────────
async function updateProduct(req, res, next) {
  try {
    const { data, error } = await supabase
      .from('products').update(req.body).eq('id', req.params.id).select().single()
    if (error) throw error
    return res.status(200).json({ success: true, product: data })
  } catch (err) { next(err) }
}

// ── DELETE /api/admin/products/:id ───────────────────────────
async function deleteProduct(req, res, next) {
  try {
    await supabase.from('products').update({ is_active: false }).eq('id', req.params.id)
    return res.status(200).json({ success: true, message: 'Product deactivated.' })
  } catch (err) { next(err) }
}

module.exports = {
  getDashboard, getUsers, setUserStatus, setUserRole,
  getAllAppointments, setAppointmentStatus,
  getAllOrders, setOrderStatus,
  createProduct, updateProduct, deleteProduct,
}