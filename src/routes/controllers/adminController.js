/* eslint-disable no-undef */
const bcrypt = require('bcryptjs')
const supabase = require('../../db/supabase')

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

//registerstaff
async function registerStaff(req, res, next) {
  try {
    const { full_name, email, phone, password, specialization, department, notes } = req.body
 
    // Validate required fields
    if (!full_name?.trim())
      return res.status(400).json({ success: false, message: 'Full name is required.' })
    if (!email?.trim())
      return res.status(400).json({ success: false, message: 'Email is required.' })
    if (!password)
      return res.status(400).json({ success: false, message: 'Password is required.' })
    if (password.length < 8)
      return res.status(400).json({ success: false, message: 'Password must be at least 8 characters.' })
    if (!/[A-Z]/.test(password))
      return res.status(400).json({ success: false, message: 'Password needs at least one uppercase letter.' })
    if (!/[0-9]/.test(password))
      return res.status(400).json({ success: false, message: 'Password needs at least one number.' })
 
    const normalizedEmail = email.trim().toLowerCase()
 
    // Check for duplicate email
    const { data: existing } = await supabase
      .from('profiles')
      .select('id')
      .eq('email', normalizedEmail)
      .maybeSingle()
 
    if (existing)
      return res.status(409).json({ success: false, message: 'A user with this email already exists.' })
 
    // Hash password
    const password_hash = await bcrypt.hash(password, 12)
 
    // 1. Insert into profiles — role is ALWAYS 'therapist', never admin/staff
    const { data: newUser, error: insertError } = await supabase
      .from('profiles')
      .insert({
        full_name:      full_name.trim(),
        email:          normalizedEmail,
        phone:          phone?.trim() || null,
        password_hash,
        role:           'therapist',           // ← hardcoded, never changes
        department:     department?.trim() || null,
        notes:          notes?.trim() || null,
        is_active:      true,
        email_verified: true,
        created_by:     req.user?.id || null,
      })
      .select('id, full_name, email, role, created_at')
      .single()
 
    if (insertError) {
      console.error('[registerStaff] Insert error:', insertError)
      if (insertError.code === '23505')
        return res.status(409).json({ success: false, message: 'A user with this email already exists.' })
      return res.status(500).json({ success: false, message: 'Database error. Please try again.' })
    }
 
    // 2. Create therapist record so they appear in the therapists table
    //    and get access to the therapist portal (/api/therapist-portal/*)
    const { error: therapistError } = await supabase
      .from('therapists')
      .insert({
        user_id:        newUser.id,
        specialization: specialization?.trim() || null,
        is_active:      true,
        is_verified:    true,
      })
 
    if (therapistError) {
      console.warn('[registerStaff] Therapist record creation failed:', therapistError.message)
      // Non-fatal — profile was created, therapist record can be added manually
    }
 
    // 3. Audit log (non-blocking)
    supabase.from('audit_logs').insert({
      actor_id:  req.user?.id,
      action:    'register_therapist',
      target_id: newUser.id,
      details:   { role: 'therapist', specialization: specialization?.trim() || null },
    }).then(({ error }) => {
      if (error) console.warn('[registerStaff] Audit log failed:', error.message)
    })
 
    return res.status(201).json({
      success: true,
      message: 'Therapist registered successfully.',
      user: newUser,
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

// ── PATCH /api/admin/users/:id/toggle-active ─────────────────
async function toggleUserActive(req, res, next) {
  try {
    const { data: current, error: fetchErr } = await supabase
      .from('profiles').select('is_active').eq('id', req.params.id).single()
    if (fetchErr) throw fetchErr

    const { data, error } = await supabase
      .from('profiles')
      .update({ is_active: !current.is_active })
      .eq('id', req.params.id)
      .select('id, full_name, email, is_active').single()
    if (error) throw error

    return res.status(200).json({ success: true, user: data })
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
    if (!['client', 'therapist', 'admin', 'staff'].includes(role))
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
    const valid = ['pending', 'confirmed', 'cancelled', 'completed', 'no_show']
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

// ── GET /api/admin/payments ───────────────────────────────────
async function getAllPayments(req, res, next) {
  try {
    const { page = 1, limit = 20 } = req.query
    const offset = (Number(page) - 1) * Number(limit)

    const { data, count, error } = await supabase
      .from('payments')
      .select(`
        id, amount, currency, method, status, transaction_id, paid_at, created_at,
        profiles!payments_client_id_fkey ( full_name, email )
      `, { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + Number(limit) - 1)

    if (error) throw error

    return res.status(200).json({
      success: true, payments: data,
      pagination: { page: Number(page), limit: Number(limit), total: count },
    })
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

async function sendNotificationToClient(req, res, next) {
  try {
    const { userId, title, message, type = 'system' } = req.body
 
    if (!userId || !title) {
      return res.status(400).json({ success: false, message: 'userId and title are required.' })
    }
 
    const validTypes = ['appointment','payment','system','reminder','message','review']
    if (!validTypes.includes(type)) {
      return res.status(400).json({ success: false, message: `Invalid type. Must be one of: ${validTypes.join(', ')}` })
    }
 
    const { data, error } = await supabase
      .from('notifications')
      .insert({
        user_id: userId,
        title,
        message: message || null,
        type,
        is_read: false,
      })
      .select()
      .single()
 
    if (error) throw error
 
    return res.status(201).json({ success: true, notification: data })
  } catch (err) { next(err) }
}

// ── GET /api/therapist-portal/appointments ────────────────────
// Returns only appointments for the logged-in therapist.
// The "clients" alias makes a.clients?.full_name work in the frontend.
async function getMyTherapistAppointments(req, res, next) {
  try {
    const userId = req.user?.sub

    if (!userId) {
      return res.status(401).json({ success: false, message: 'Not authenticated.' })
    }

    const { data: therapistRecord, error: tErr } = await supabase
      .from('therapists')
      .select('id')
      .eq('user_id', userId)
      .single()

    if (tErr || !therapistRecord) {
      return res.status(404).json({ success: false, message: 'Therapist profile not found for this account.' })
    }

    const { status, page = 1, limit = 50 } = req.query
    const offset = (Number(page) - 1) * Number(limit)

    let query = supabase
      .from('appointments')
      .select(`
        id, scheduled_at, type, status, duration_minutes,
        notes, cancellation_reason, created_at,
        client_id, therapist_id,
        clients:profiles!appointments_client_id_fkey (
          id, full_name, email, phone, avatar_url, date_of_birth, gender
        )
      `, { count: 'exact' })
      .eq('therapist_id', therapistRecord.id)
      .order('scheduled_at', { ascending: false })
      .range(offset, offset + Number(limit) - 1)

    if (status) query = query.eq('status', status)

    const { data, count, error } = await query
    if (error) throw error

    return res.status(200).json({
      success: true,
      appointments: data || [],
      pagination: { page: Number(page), limit: Number(limit), total: count || 0 },
    })
  } catch (err) { next(err) }
}

module.exports = {
  getDashboard,
  getUsers, toggleUserActive, setUserStatus, setUserRole,
  getAllAppointments, setAppointmentStatus,
  getAllOrders, setOrderStatus,sendNotificationToClient,
  getAllPayments, registerStaff,
  createProduct, updateProduct, deleteProduct,
  getMyTherapistAppointments,
}