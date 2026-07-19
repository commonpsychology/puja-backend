/* eslint-disable no-undef */
// routes/controllers/adminController.js

const bcrypt   = require('bcryptjs')
const supabase = require('../../db/supabase')
const { getAllPaymentsAdmin } = require('./paymentController')
const { sendSms: sendSparrowSms } = require('../services/sparrowSms')
const { sendNotificationEmail } = require('../services/mailer')
// HELPERS
// ─────────────────────────────────────────────────────────────

function paginated(data, count, page, limit) {
  return {
    success: true,
    items:   data || [],
    pagination: {
      page:  Number(page),
      limit: Number(limit),
      total: count || 0,
    },
  }
}

function makeCreate(table) {
  return async (req, res, next) => {
    try {
      const { data, error } = await supabase
        .from(table).insert(req.body).select().single()
      if (error) throw error
      return res.status(201).json({ success: true, item: data })
    } catch (err) { next(err) }
  }
}

function makeUpdate(table) {
  return async (req, res, next) => {
    try {
      const { data, error } = await supabase
        .from(table).update(req.body).eq('id', req.params.id).select().single()
      if (error) throw error
      return res.status(200).json({ success: true, item: data })
    } catch (err) { next(err) }
  }
}

function makeSoftDelete(table) {
  return async (req, res, next) => {
    try {
      const { error } = await supabase
        .from(table).update({ is_active: false }).eq('id', req.params.id)
      if (error) throw error
      return res.status(200).json({ success: true, message: 'Record deactivated.' })
    } catch (err) { next(err) }
  }
}

function makeHardDelete(table) {
  return async (req, res, next) => {
    try {
      const { error } = await supabase
        .from(table).delete().eq('id', req.params.id)
      if (error) throw error
      return res.status(200).json({ success: true, message: 'Record deleted.' })
    } catch (err) { next(err) }
  }
}

// ─────────────────────────────────────────────────────────────
// DASHBOARD
// ─────────────────────────────────────────────────────────────
async function getDashboard(req, res, next) {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

    const [
      { count: totalUsers },
      { count: totalAppointments },
      { count: pendingAppointments },
      { count: totalOrders },
      { data: recentPaymentsRaw },
    ] = await Promise.all([
      supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('role', 'client'),
      supabase.from('appointments').select('*', { count: 'exact', head: true }),
      supabase.from('appointments').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
      supabase.from('orders').select('*', { count: 'exact', head: true }),
      supabase
        .from('payments')
        .select(`
          id, amount, status, method, currency, category,
          transaction_id, created_at, paid_at,
          appointment_id, order_id, client_id,
          profiles!payments_client_id_fkey ( full_name, email )
        `)
        .order('created_at', { ascending: false })
        .limit(8),
    ])

    const revenue30d = (recentPaymentsRaw || [])
      .filter(p => p.status === 'completed' && p.created_at >= thirtyDaysAgo)
      .reduce((s, p) => s + Number(p.amount || 0), 0)

    const recentPayments = (recentPaymentsRaw || []).map(p => ({
      ...p,
      client_name: p.profiles?.full_name || null,
    }))

    return res.status(200).json({
      success: true,
      stats: { totalUsers, totalAppointments, pendingAppointments, totalOrders, revenue30d },
      recentPayments,
    })
  } catch (err) { next(err) }
}

// ─────────────────────────────────────────────────────────────
// STAFF REGISTRATION
// ─────────────────────────────────────────────────────────────
async function registerStaff(req, res, next) {
  try {
    // FIX 1: destructure role from req.body (was missing — caused hardcoded 'therapist')
    const { full_name, email, phone, password, role, specialization, department, notes } = req.body

    if (!full_name?.trim()) return res.status(400).json({ success: false, message: 'Full name is required.' })
    if (!email?.trim())     return res.status(400).json({ success: false, message: 'Email is required.' })
    if (!password)          return res.status(400).json({ success: false, message: 'Password is required.' })
    if (password.length < 8)     return res.status(400).json({ success: false, message: 'Password must be at least 8 characters.' })
    if (!/[A-Z]/.test(password)) return res.status(400).json({ success: false, message: 'Password needs at least one uppercase letter.' })
    if (!/[0-9]/.test(password)) return res.status(400).json({ success: false, message: 'Password needs at least one number.' })

    // FIX 2: validate role instead of assuming therapist
    if (!['staff', 'therapist', 'admin'].includes(role))
      return res.status(400).json({ success: false, message: 'Invalid role. Must be staff, therapist, or admin.' })

    const normalizedEmail = email.trim().toLowerCase()
    const { data: existing } = await supabase.from('profiles').select('id').eq('email', normalizedEmail).maybeSingle()
    if (existing) return res.status(409).json({ success: false, message: 'A user with this email already exists.' })

    const password_hash = await bcrypt.hash(password, 12)

    const { data: newUser, error: insertError } = await supabase
      .from('profiles')
      .insert({
        full_name: full_name.trim(), email: normalizedEmail,
        phone: phone?.trim() || null, password_hash,
        role, // FIX 3: use role variable instead of hardcoded 'therapist'
        department: department?.trim() || null, notes: notes?.trim() || null,
        is_active: true, is_email_verified: true,
        created_by: req.user?.sub || req.user?.id || null,
      })
      .select('id, full_name, email, role, created_at')
      .single()

    if (insertError) {
      if (insertError.code === '23505') return res.status(409).json({ success: false, message: 'A user with this email already exists.' })
      return res.status(500).json({ success: false, message: 'Database error. Please try again.' })
    }

    // FIX 4: only insert into therapists table when role is actually therapist
    if (role === 'therapist') {
      const { data: therapistRow, error: therapistError } = await supabase
        .from('therapists')
        .insert({
          user_id: newUser.id,
          license_type: specialization?.trim() || 'Licensed Therapist',
          specializations: specialization?.trim() ? [specialization.trim()] : [],
          is_available: true, is_verified: true,
          consultation_fee: 2000, session_duration: 60,
          experience_years: 0, rating: 0, total_reviews: 0,
          languages_spoken: ['Nepali', 'English'],
        })
        .select('id').single()

      if (therapistError) {
        await supabase.from('profiles').delete().eq('id', newUser.id)
        return res.status(500).json({ success: false, message: `Therapist record failed: ${therapistError.message}. Profile rolled back.` })
      }
    }

    // FIX 5: audit log reflects actual role
    supabase.from('audit_logs').insert({
      actor_id: req.user?.sub || req.user?.id, action: `register_${role}`,
      target_id: newUser.id, details: { role, specialization: specialization?.trim() || null },
    })

    return res.status(201).json({ success: true, message: `${role.charAt(0).toUpperCase() + role.slice(1)} registered successfully.`, user: newUser })
  } catch (err) { next(err) }
}

// ─────────────────────────────────────────────────────────────
// USERS
// ─────────────────────────────────────────────────────────────
async function getUsers(req, res, next) {
  try {
    const { role, search, q, page = 1, limit = 20 } = req.query
    const offset = (Number(page) - 1) * Number(limit)

    let query = supabase
      .from('profiles')
      .select('id, full_name, email, phone, role, is_active, is_email_verified, department, created_at, emergency_contact_name, emergency_contact_phone, emergency_contact_relation', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + Number(limit) - 1)

    if (role)        query = query.eq('role', role)
    if (search || q) query = query.or(`full_name.ilike.%${search || q}%,email.ilike.%${search || q}%`)

    const { data, count, error } = await query
    if (error) throw error
    return res.status(200).json({ success: true, users: data, pagination: { page: Number(page), limit: Number(limit), total: count } })
  } catch (err) { next(err) }
}

async function toggleUserActive(req, res, next) {
  try {
    const { data: current, error: fe } = await supabase.from('profiles').select('is_active').eq('id', req.params.id).single()
    if (fe) throw fe
    const { data, error } = await supabase.from('profiles').update({ is_active: !current.is_active }).eq('id', req.params.id).select('id, full_name, email, is_active').single()
    if (error) throw error
    return res.status(200).json({ success: true, user: data })
  } catch (err) { next(err) }
}

async function setUserStatus(req, res, next) {
  try {
    const { is_active } = req.body
    const { data, error } = await supabase.from('profiles').update({ is_active }).eq('id', req.params.id).select('id, full_name, email, is_active').single()
    if (error) throw error
    return res.status(200).json({ success: true, user: data })
  } catch (err) { next(err) }
}

async function setUserRole(req, res, next) {
  try {
    const { role } = req.body
    if (!['client', 'therapist', 'admin', 'staff'].includes(role))
      return res.status(400).json({ success: false, message: 'Invalid role.' })
    const { data, error } = await supabase.from('profiles').update({ role }).eq('id', req.params.id).select('id, full_name, email, role').single()
    if (error) throw error
    return res.status(200).json({ success: true, user: data })
  } catch (err) { next(err) }
}

// ─────────────────────────────────────────────────────────────
// APPOINTMENTS
// ─────────────────────────────────────────────────────────────
async function getAllAppointments(req, res, next) {
  try {
    const { status, from, to, page = 1, limit = 20 } = req.query
    const offset = (Number(page) - 1) * Number(limit)

    let query = supabase
      .from('appointments')
      .select(`
        id, scheduled_at, type, status, duration_minutes,
        notes, meeting_link, cancellation_reason, created_at,
        client_id, therapist_id,
        clients:profiles!appointments_client_id_fkey ( id, full_name, email, phone ),
        therapists ( profiles!therapists_user_id_fkey ( full_name ) )
      `, { count: 'exact' })
      .order('scheduled_at', { ascending: false })
      .range(offset, offset + Number(limit) - 1)

    if (status) query = query.eq('status', status)
    if (from)   query = query.gte('scheduled_at', from)
    if (to)     query = query.lte('scheduled_at', to)

    const { data, count, error } = await query
    if (error) throw error

    const appointments = (data || []).map(a => ({
      ...a,
      client_name:    a.clients?.full_name || null,
      therapist_name: a.therapists?.profiles?.full_name || null,
    }))

    return res.status(200).json({ success: true, appointments, pagination: { page: Number(page), limit: Number(limit), total: count } })
  } catch (err) { next(err) }
}

async function setAppointmentStatus(req, res, next) {
  try {
    const { status } = req.body
    const valid = ['pending', 'confirmed', 'cancelled', 'completed', 'no_show']
    if (!valid.includes(status)) return res.status(400).json({ success: false, message: 'Invalid status.' })
    const { data, error } = await supabase.from('appointments').update({ status }).eq('id', req.params.id).select().single()
    if (error) throw error
    return res.status(200).json({ success: true, appointment: data })
  } catch (err) { next(err) }
}

// ─────────────────────────────────────────────────────────────
// ORDERS
async function getAllOrders(req, res, next) {
  try {
    const { status, delivery_status, page = 1, limit = 20 } = req.query
    const offset = (Number(page) - 1) * Number(limit)

   let query = supabase
      .from('orders')
      .select(`
        id, order_number, status, subtotal, total_amount,
        discount_amount, tax_amount, coupon_code, notes, created_at,
        delivery_status, delivery_rider_id,
        shipping_address,
        clients:profiles!orders_client_id_fkey ( id, full_name, email ),
        delivery_riders (
          id, area, vehicle_type,
          profiles ( full_name )
        )
      `, { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + Number(limit) - 1)

    if (status)          query = query.eq('status', status)
    if (delivery_status) query = query.eq('delivery_status', delivery_status)

    const { data, count, error } = await query
    if (error) throw error

    const orders = (data || []).map(o => ({
      ...o,
      client_name:         o.clients?.full_name || null,
      delivery_rider_name: o.delivery_riders?.profiles?.full_name || null,
      rider_area:          o.delivery_riders?.area || null,
    }))

    return res.status(200).json({
      success: true,
      orders,
      pagination: { page: Number(page), limit: Number(limit), total: count },
    })
  } catch (err) { next(err) }
}

async function setOrderStatus(req, res, next) {
  try {
    const { status } = req.body
    const { data, error } = await supabase.from('orders').update({ status }).eq('id', req.params.id).select().single()
    if (error) throw error
    return res.status(200).json({ success: true, order: data })
  } catch (err) { next(err) }
}

// ─────────────────────────────────────────────────────────────
// PAYMENTS
// ─────────────────────────────────────────────────────────────
async function getPayments(req, res, next) {
  try {
    const { status, method, category, page = 1, limit = 20 } = req.query
    const offset = (Number(page) - 1) * Number(limit)

    let query = supabase
      .from('payments')
      .select(`
        id, amount, currency, method, status, category,
        transaction_id, gateway_response,
        appointment_id, order_id, client_id,
        paid_at, created_at,
        profiles!payments_client_id_fkey ( full_name, email )
      `, { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + Number(limit) - 1)

    if (status)   query = query.eq('status', status)
    if (method)   query = query.eq('method', method)
    if (category) query = query.eq('category', category)

    const { data, count, error } = await query
    if (error) throw error

    const payments = (data || []).map(p => ({ ...p, client_name: p.profiles?.full_name || null }))
    return res.status(200).json({ success: true, payments, pagination: { page: Number(page), limit: Number(limit), total: count } })
  } catch (err) { next(err) }
}

async function updatePaymentStatus(req, res, next) {
  try {
    const { status } = req.body
    const valid = ['pending', 'pending_cod', 'completed', 'failed', 'refunded']
    if (!valid.includes(status)) return res.status(400).json({ success: false, message: 'Invalid status.' })

    // Fetch first — need appointment_id / room_booking_id / coupon_id to cascade.
    const { data: existing, error: fetchErr } = await supabase
      .from('payments').select('*').eq('id', req.params.id).single()
    if (fetchErr || !existing) return res.status(404).json({ success: false, message: 'Payment not found.' })

    const updateData = { status }
    if (status === 'completed') updateData.paid_at = new Date().toISOString()

    const { data, error } = await supabase.from('payments').update(updateData).eq('id', req.params.id).select().single()
    if (error) throw error

    // ── Cascade: keep the linked appointment/room booking in sync ──
    // Without this, rejecting/refunding a payment leaves the booking stuck
    // at status:'pending' forever, permanently locking that date+time even
    // though no money ever cleared for it. Confirming must flip the booking
    // to confirmed too, not just the payment row.
    if (existing.appointment_id) {
      if (status === 'completed') {
        await supabase.from('appointments')
          .update({ status: 'confirmed', payment_status: 'paid' })
          .eq('id', existing.appointment_id)
          .eq('status', 'pending')
      } else if (status === 'failed' || status === 'refunded') {
        await supabase.from('appointments')
          .update({ status: 'cancelled', payment_status: status === 'refunded' ? 'refunded' : 'failed' })
          .eq('id', existing.appointment_id)
      }
    }

    if (existing.room_booking_id) {
      if (status === 'completed') {
        await supabase.from('room_bookings')
          .update({ status: 'confirmed', payment_status: 'paid' })
          .eq('id', existing.room_booking_id)
          .eq('status', 'pending')
      } else if (status === 'failed' || status === 'refunded') {
        await supabase.from('room_bookings')
          .update({ status: 'cancelled', payment_status: status === 'refunded' ? 'refunded' : 'failed' })
          .eq('id', existing.room_booking_id)
      }
    }

    // Release any coupon this payment claimed, so it can be reused
    if ((status === 'failed' || status === 'refunded') && existing.coupon_id) {
      await supabase.from('coupons')
        .update({ used_by: null, used_at: null })
        .eq('id', existing.coupon_id)
    }

    return res.status(200).json({ success: true, payment: data })
  } catch (err) { next(err) }
}
// ─────────────────────────────────────────────────────────────
// NOTIFICATIONS
// ─────────────────────────────────────────────────────────────
async function sendNotificationToClient(req, res, next) {
  try {
    const { userId, title, message, type = 'system' } = req.body
    if (!userId || !title) return res.status(400).json({ success: false, message: 'userId and title are required.' })
    const valid = ['appointment', 'payment', 'system', 'reminder', 'message', 'review']
    if (!valid.includes(type)) return res.status(400).json({ success: false, message: `Invalid type. Must be: ${valid.join(', ')}` })

    const { data, error } = await supabase
      .from('notifications')
      .insert({ user_id: userId, title, message: message || null, type, is_read: false })
      .select().single()
    if (error) throw error

    // Look up the client's email and send them a real email too — non-blocking
    const { data: profile } = await supabase
      .from('profiles')
      .select('email, full_name')
      .eq('id', userId)
      .maybeSingle()

    if (profile?.email) {
      sendNotificationEmail({ to: profile.email, title, message }).catch(err =>
        console.error('[sendNotificationToClient] email failed for', profile.email, err.message)
      )
    }

    return res.status(201).json({ success: true, notification: data })
  } catch (err) { next(err) }
}

// ─────────────────────────────────────────────────────────────
// PRODUCTS
// ─────────────────────────────────────────────────────────────
async function getProducts(req, res, next) {
  try {
    const { page = 1, limit = 20, search, q } = req.query
    const offset = (Number(page) - 1) * Number(limit)
    let query = supabase
      .from('products')
      .select('id, name, slug, sku, price, sale_price, stock_quantity, is_digital, is_active, is_featured, tags, created_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + Number(limit) - 1)
    if (search || q) query = query.or(`name.ilike.%${search || q}%,slug.ilike.%${search || q}%,sku.ilike.%${search || q}%`)
    const { data, count, error } = await query
    if (error) throw error
    return res.status(200).json(paginated(data, count, page, limit))
  } catch (err) { next(err) }
}

const createProduct = makeCreate('products')
const updateProduct = makeUpdate('products')
async function deleteProduct(req, res, next) {
  try {
    const { error } = await supabase.from('products').update({ is_active: false }).eq('id', req.params.id)
    if (error) throw error
    return res.status(200).json({ success: true, message: 'Product deactivated.' })
  } catch (err) { next(err) }
}

// ─────────────────────────────────────────────────────────────
// BLOG POSTS
// ─────────────────────────────────────────────────────────────
async function getPosts(req, res, next) {
  try {
    const { page = 1, limit = 20, status, search, q } = req.query
    const offset = (Number(page) - 1) * Number(limit)
    let query = supabase
      .from('posts')
      .select('id, title, slug, excerpt, category, author_name, author_role, status, featured, views, tags, read_time, published_at, created_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + Number(limit) - 1)
    if (status)      query = query.eq('status', status)
    if (search || q) query = query.or(`title.ilike.%${search || q}%,slug.ilike.%${search || q}%`)
    const { data, count, error } = await query
    if (error) throw error
    return res.status(200).json(paginated(data, count, page, limit))
  } catch (err) { next(err) }
}

const createPost = makeCreate('posts')
const updatePost = makeUpdate('posts')
async function deletePost(req, res, next) {
  try {
    const { error } = await supabase.from('posts').update({ status: 'archived' }).eq('id', req.params.id)
    if (error) throw error
    return res.status(200).json({ success: true, message: 'Post archived.' })
  } catch (err) { next(err) }
}

// ─────────────────────────────────────────────────────────────
// NEWS ARTICLES
// ─────────────────────────────────────────────────────────────
async function getNews(req, res, next) {
  try {
    const { page = 1, limit = 20, search, q } = req.query
    const offset = (Number(page) - 1) * Number(limit)
    let query = supabase
      .from('news_articles')
      .select('id, headline, slug, summary, author, author_role, tag, size, is_featured, is_published, views, published_at, created_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + Number(limit) - 1)
    if (search || q) query = query.or(`headline.ilike.%${search || q}%,slug.ilike.%${search || q}%`)
    const { data, count, error } = await query
    if (error) throw error
    return res.status(200).json(paginated(data, count, page, limit))
  } catch (err) { next(err) }
}

const createNews = makeCreate('news_articles')
const updateNews = makeUpdate('news_articles')
const deleteNews = makeHardDelete('news_articles')

// ─────────────────────────────────────────────────────────────
// RESOURCES
// ─────────────────────────────────────────────────────────────
async function getResources(req, res, next) {
  try {
    const { page = 1, limit = 20, search, q } = req.query
    const offset = (Number(page) - 1) * Number(limit)
    let query = supabase
      .from('resources')
      .select('id, title, description, category, file_type, type_label, emoji, price_label, is_free, access_level, download_count, is_active, sort_order, created_at', { count: 'exact' })
      .order('sort_order', { ascending: true })
      .range(offset, offset + Number(limit) - 1)
    if (search || q) query = query.or(`title.ilike.%${search || q}%,category.ilike.%${search || q}%`)
    const { data, count, error } = await query
    if (error) throw error
    return res.status(200).json(paginated(data, count, page, limit))
  } catch (err) { next(err) }
}

const createResource = makeCreate('resources')
const updateResource = makeUpdate('resources')
const deleteResource = makeSoftDelete('resources')

// ─────────────────────────────────────────────────────────────
// GALLERY
// ─────────────────────────────────────────────────────────────
async function getGallery(req, res, next) {
  try {
    const { page = 1, limit = 20, search, q } = req.query
    const offset = (Number(page) - 1) * Number(limit)
    let query = supabase
      .from('gallery_items')
      .select('id, title, description, category, emoji, gradient, event_date, col_span, row_span, sort_order, is_active, created_at', { count: 'exact' })
      .order('sort_order', { ascending: true })
      .range(offset, offset + Number(limit) - 1)
    if (search || q) query = query.or(`title.ilike.%${search || q}%,category.ilike.%${search || q}%`)
    const { data, count, error } = await query
    if (error) throw error
    return res.status(200).json(paginated(data, count, page, limit))
  } catch (err) { next(err) }
}

const createGalleryItem = makeCreate('gallery_items')
const updateGalleryItem = makeUpdate('gallery_items')
const deleteGalleryItem = makeSoftDelete('gallery_items')

// ─────────────────────────────────────────────────────────────
// RESEARCH PAPERS
// ─────────────────────────────────────────────────────────────
async function getResearch(req, res, next) {
  try {
    const { page = 1, limit = 20, search, q } = req.query
    const offset = (Number(page) - 1) * Number(limit)
    let query = supabase
      .from('research_papers')
      .select('id, title, authors, journal, year, doi, type, citations, downloads, open_access, is_active, sort_order, created_at', { count: 'exact' })
      .order('sort_order', { ascending: true })
      .range(offset, offset + Number(limit) - 1)
    if (search || q) query = query.or(`title.ilike.%${search || q}%,journal.ilike.%${search || q}%`)
    const { data, count, error } = await query
    if (error) throw error
    return res.status(200).json(paginated(data, count, page, limit))
  } catch (err) { next(err) }
}

async function createResearch(req, res, next) {
  try {
    const body = { ...req.body }
    if (body.paper_type && !body.type) { body.type = body.paper_type; delete body.paper_type }
    if (body.is_open !== undefined && body.open_access === undefined) { body.open_access = body.is_open; delete body.is_open }
    const { data, error } = await supabase.from('research_papers').insert(body).select().single()
    if (error) throw error
    return res.status(201).json({ success: true, item: data })
  } catch (err) { next(err) }
}

async function updateResearch(req, res, next) {
  try {
    const body = { ...req.body }
    if (body.paper_type && !body.type) { body.type = body.paper_type; delete body.paper_type }
    if (body.is_open !== undefined && body.open_access === undefined) { body.open_access = body.is_open; delete body.is_open }
    const { data, error } = await supabase.from('research_papers').update(body).eq('id', req.params.id).select().single()
    if (error) throw error
    return res.status(200).json({ success: true, item: data })
  } catch (err) { next(err) }
}

const deleteResearch = makeSoftDelete('research_papers')

// ─────────────────────────────────────────────────────────────
// PSYCH VIDEOS
// ─────────────────────────────────────────────────────────────
async function getPsychVideos(req, res, next) {
  try {
    const { page = 1, limit = 20 } = req.query
    const offset = (Number(page) - 1) * Number(limit)
    const { data, count, error } = await supabase
      .from('psych_videos')
      .select('id, youtube_id, title, description, duration, views, sort_order, is_active, created_at', { count: 'exact' })
      .order('sort_order', { ascending: true })
      .range(offset, offset + Number(limit) - 1)
    if (error) throw error
    return res.status(200).json(paginated(data, count, page, limit))
  } catch (err) { next(err) }
}

const createPsychVideo = makeCreate('psych_videos')
const updatePsychVideo = makeUpdate('psych_videos')
const deletePsychVideo = makeSoftDelete('psych_videos')


async function getPsychAnalyses(req, res, next) {
  try {
    const { page = 1, limit = 20, search, q } = req.query
    const offset = (Number(page) - 1) * Number(limit)
    let query = supabase
      .from('psych_analyses')
      .select('id, title, slug, category, icon, color_var, excerpt, content, concepts, read_time, is_active, sort_order, published_at, created_at', { count: 'exact' })
      .order('sort_order', { ascending: true })
      .range(offset, offset + Number(limit) - 1)
    if (search || q) query = query.or(`title.ilike.%${search || q}%,category.ilike.%${search || q}%`)
    const { data, count, error } = await query
    if (error) throw error
    return res.status(200).json(paginated(data, count, page, limit))
  } catch (err) { next(err) }
}

const createPsychAnalysis = makeCreate('psych_analyses')
const updatePsychAnalysis = makeUpdate('psych_analyses')
const deletePsychAnalysis = makeSoftDelete('psych_analyses')

// ─────────────────────────────────────────────────────────────
// PSYCH CONCEPTS
// ─────────────────────────────────────────────────────────────
async function getPsychConcepts(req, res, next) {
  try {
    const { page = 1, limit = 20, search, q } = req.query
    const offset = (Number(page) - 1) * Number(limit)
    let query = supabase
      .from('psych_concepts')
      .select('id, term, definition, sort_order, is_active, created_at', { count: 'exact' })
      .order('sort_order', { ascending: true })
      .range(offset, offset + Number(limit) - 1)
    if (search || q) query = query.or(`term.ilike.%${search || q}%,definition.ilike.%${search || q}%`)
    const { data, count, error } = await query
    if (error) throw error
    return res.status(200).json(paginated(data, count, page, limit))
  } catch (err) { next(err) }
}

async function createPsychConcept(req, res, next) {
  try {
    const { term, definition, sort_order, is_active } = req.body
    if (!term?.trim())       return res.status(400).json({ success: false, message: 'term is required.' })
    if (!definition?.trim()) return res.status(400).json({ success: false, message: 'definition is required.' })
    const { data, error } = await supabase
      .from('psych_concepts')
      .insert({ term: term.trim(), definition: definition.trim(), sort_order: sort_order ?? 0, is_active: is_active ?? true })
      .select().single()
    if (error) throw error
    return res.status(201).json({ success: true, item: data })
  } catch (err) { next(err) }
}

async function updatePsychConcept(req, res, next) {
  try {
    const body = { ...req.body }
    delete body.id
    const { data, error } = await supabase
      .from('psych_concepts').update(body).eq('id', req.params.id).select().single()
    if (error) throw error
    if (!data) return res.status(404).json({ success: false, message: 'Concept not found.' })
    return res.status(200).json({ success: true, item: data })
  } catch (err) { next(err) }
}

const deletePsychConcept = makeHardDelete('psych_concepts')

// ─────────────────────────────────────────────────────────────
// COURSES
// ─────────────────────────────────────────────────────────────
async function getCourses(req, res, next) {
  try {
    const { page = 1, limit = 20, search, q } = req.query
    const offset = (Number(page) - 1) * Number(limit)
    let query = supabase
      .from('courses')
      .select('id, title, slug, emoji, level, price, price_label, is_free, is_published, lessons_count, duration_hours, tags, color, created_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + Number(limit) - 1)
    if (search || q) query = query.or(`title.ilike.%${search || q}%,slug.ilike.%${search || q}%`)
    const { data, count, error } = await query
    if (error) throw error
    return res.status(200).json(paginated(data, count, page, limit))
  } catch (err) { next(err) }
}

const createCourse = makeCreate('courses')
const updateCourse = makeUpdate('courses')
async function deleteCourse(req, res, next) {
  try {
    const { error } = await supabase.from('courses').update({ is_published: false }).eq('id', req.params.id)
    if (error) throw error
    return res.status(200).json({ success: true, message: 'Course unpublished.' })
  } catch (err) { next(err) }
}

// ─────────────────────────────────────────────────────────────
// THERAPISTS
// ─────────────────────────────────────────────────────────────
async function getTherapists(req, res, next) {
  try {
    const { page = 1, limit = 20 } = req.query
    const offset = (Number(page) - 1) * Number(limit)

    const { data, count, error } = await supabase
      .from('therapists')
      .select(`
        id, user_id, license_number, license_type, specializations,
        education, experience_years, bio, languages_spoken,
        consultation_fee, session_duration, is_available, is_verified,
        rating, total_reviews, video_url, created_at
      `, { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + Number(limit) - 1)

    if (error) throw error
    if (!data || data.length === 0)
      return res.status(200).json(paginated([], count, page, limit))

    const userIds = data.map(t => t.user_id).filter(Boolean)
    const { data: profiles, error: pe } = await supabase
      .from('profiles')
      .select('id, full_name, email, phone, avatar_url, department, is_active')
      .in('id', userIds)

    if (pe) throw pe

    const profileMap = {}
    ;(profiles || []).forEach(p => { profileMap[p.id] = p })

    const items = data.map(t => ({
      ...t,
      full_name:  profileMap[t.user_id]?.full_name  || null,
      email:      profileMap[t.user_id]?.email      || null,
      phone:      profileMap[t.user_id]?.phone      || null,
      avatar_url: profileMap[t.user_id]?.avatar_url || null,
      department: profileMap[t.user_id]?.department || null,
      is_active:  profileMap[t.user_id]?.is_active  ?? true,
    }))

    return res.status(200).json(paginated(items, count, page, limit))
  } catch (err) { next(err) }
}

async function updateTherapist(req, res, next) {
  try {
    const body = { ...req.body }
    const profileFields = ['full_name', 'email', 'phone', 'avatar_url', 'department', 'is_active']
    const profileUpdate = {}
    profileFields.forEach(f => {
      if (body[f] !== undefined) { profileUpdate[f] = body[f]; delete body[f] }
    })

    const allowedTherapistFields = [
      'license_number', 'license_type', 'specializations', 'education',
      'experience_years', 'bio', 'languages_spoken', 'consultation_fee',
      'session_duration', 'is_available', 'is_verified', 'video_url',
    ]
    Object.keys(body).forEach(k => {
      if (!allowedTherapistFields.includes(k)) delete body[k]
    })

    let therapistData = null
    if (Object.keys(body).length > 0) {
      const { data, error: te } = await supabase
        .from('therapists').update(body).eq('id', req.params.id).select('id, user_id').single()
      if (te) throw te
      therapistData = data
    } else {
      const { data, error: fe } = await supabase
        .from('therapists').select('id, user_id').eq('id', req.params.id).single()
      if (fe) throw fe
      therapistData = data
    }

    if (Object.keys(profileUpdate).length > 0 && therapistData?.user_id) {
      const { error: pe } = await supabase
        .from('profiles').update(profileUpdate).eq('id', therapistData.user_id)
      if (pe) throw pe
    }

    return res.status(200).json({ success: true, item: therapistData })
  } catch (err) { next(err) }
}

async function createTherapist(req, res, next) {
  try {
    const {
      full_name, email, phone, avatar_url, department, is_active,
      license_number, license_type, specializations, education,
      bio, consultation_fee, session_duration, experience_years,
      languages_spoken, is_available, is_verified, video_url,
    } = req.body

    if (!full_name?.trim()) return res.status(400).json({ success: false, message: 'full_name is required.' })
    if (!email?.trim())     return res.status(400).json({ success: false, message: 'email is required.' })

    const { data: existing } = await supabase.from('profiles')
      .select('id').eq('email', email.trim().toLowerCase()).maybeSingle()
    if (existing) return res.status(409).json({ success: false, message: 'Email already exists.' })

    const { data: profile, error: pe } = await supabase.from('profiles')
      .insert({
        full_name: full_name.trim(),
        email: email.trim().toLowerCase(),
        phone: phone?.trim() || null,
        avatar_url: avatar_url || null,
        department: department?.trim() || null,
        role: 'therapist',
        is_active: is_active ?? true,
        is_email_verified: true,
        created_by: req.user?.sub || req.user?.id || null,
      })
      .select('id').single()
    if (pe) throw pe

    const { data: therapist, error: te } = await supabase.from('therapists')
      .insert({
        user_id:          profile.id,
        license_number:   license_number?.trim() || null,
        license_type:     license_type?.trim() || 'Licensed Therapist',
        specializations:  specializations || [],
        education:        education || null,
        bio:              bio?.trim() || null,
        consultation_fee: consultation_fee || 2000,
        session_duration: session_duration || 60,
        experience_years: experience_years || 0,
        languages_spoken: languages_spoken || ['Nepali', 'English'],
        is_available:     is_available ?? true,
        is_verified:      is_verified ?? true,
        video_url:        video_url || null,
        rating:           0,
        total_reviews:    0,
      })
      .select().single()

    if (te) {
      await supabase.from('profiles').delete().eq('id', profile.id)
      throw te
    }

    return res.status(201).json({ success: true, item: { ...therapist, full_name, email } })
  } catch (err) { next(err) }
}

async function deleteTherapist(req, res, next) {
  try {
    const { data: t, error: fe } = await supabase
      .from('therapists').select('user_id').eq('id', req.params.id).single()
    if (fe) throw fe
    await supabase.from('therapists').update({ is_available: false }).eq('id', req.params.id)
    if (t?.user_id) {
      await supabase.from('profiles').update({ is_active: false }).eq('id', t.user_id)
    }
    return res.status(200).json({ success: true, message: 'Therapist deactivated.' })
  } catch (err) { next(err) }
}

async function getSocialWorkPrograms(req, res, next) {
  try {
    const { page = 1, limit = 50, search, q, include_inactive } = req.query
    const offset = (Number(page) - 1) * Number(limit)

    let query = supabase
      .from('social_work_programs')
      .select('*', { count: 'exact' })
      .order('sort_order', { ascending: true })
      .range(offset, offset + Number(limit) - 1)

    if (include_inactive !== 'true') query = query.eq('is_active', true)

    if (search || q) {
      query = query.or(`title.ilike.%${search || q}%,region.ilike.%${search || q}%,type.ilike.%${search || q}%`)
    }

    const { data, count, error } = await query
    if (error) throw error
    return res.status(200).json(paginated(data, count, page, limit))
  } catch (err) { next(err) }
}

async function createSocialWorkProgram(req, res, next) {
  try {
    const {
      title, region, type, status, since, beneficiaries,
      emoji, img_gradient, short_desc, full_desc,
      tags, partners, outcomes, extra_content,
      sort_order, is_active,
    } = req.body

    if (!title?.trim()) return res.status(400).json({ success: false, message: 'title is required' })

    const payload = {
      title:        title.trim(),
      region:       region       || '',
      type:         type         || '',
      status:       status       || 'Active',
      since:        since        || '',
      beneficiaries: beneficiaries || '',
      emoji:        emoji        || '🤝',
      img_gradient: img_gradient || 'linear-gradient(135deg, #007BA8 0%, #00BFFF 100%)',
      short_desc:   short_desc   || '',
      full_desc:    full_desc    || '',
      tags:         Array.isArray(tags)     ? tags     : [],
      partners:     Array.isArray(partners) ? partners : [],
      outcomes:     Array.isArray(outcomes) ? outcomes : [],
      extra_content: extra_content || {},
      sort_order:   sort_order != null ? Number(sort_order) : 0,
      is_active:    is_active !== false,
    }

    const { data, error } = await supabase
      .from('social_work_programs')
      .insert(payload)
      .select()
      .single()
    if (error) throw error
    return res.status(201).json({ success: true, item: data })
  } catch (err) { next(err) }
}

async function updateSocialWorkProgram(req, res, next) {
  try {
    const allowed = [
      'title', 'region', 'type', 'status', 'since', 'beneficiaries',
      'emoji', 'img_gradient', 'short_desc', 'full_desc',
      'tags', 'partners', 'outcomes', 'extra_content',
      'sort_order', 'is_active',
    ]
    const updates = {}
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        if (key === 'sort_order') updates[key] = Number(req.body[key])
        else updates[key] = req.body[key]
      }
    }
    if (Object.keys(updates).length === 0)
      return res.status(400).json({ success: false, message: 'No fields to update' })

    const { data, error } = await supabase
      .from('social_work_programs')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .single()
    if (error) throw error
    if (!data) return res.status(404).json({ success: false, message: 'Program not found' })
    return res.status(200).json({ success: true, item: data })
  } catch (err) { next(err) }
}

async function deleteSocialWorkProgram(req, res, next) {
  try {
    const { data, error } = await supabase
      .from('social_work_programs')
      .update({ is_active: false })
      .eq('id', req.params.id)
      .select('id')
      .single()
    if (error) throw error
    return res.status(200).json({ success: true, message: 'Program deactivated.' })
  } catch (err) { next(err) }
}

async function getPublicSocialWorkPrograms(req, res, next) {
  try {
    const { data, error } = await supabase
      .from('social_work_programs')
      .select('*')
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
    if (error) throw error
    return res.status(200).json({ success: true, programs: data || [] })
  } catch (err) { next(err) }
}



// ─────────────────────────────────────────────────────────────
// FAQs
// ─────────────────────────────────────────────────────────────
async function getFaqs(req, res, next) {
  try {
    const { page = 1, limit = 20, search, q } = req.query
    const offset = (Number(page) - 1) * Number(limit)
    let query = supabase
      .from('faqs')
      .select('id, question, answer, category, sort_order, is_active, created_at', { count: 'exact' })
      .order('sort_order', { ascending: true })
      .range(offset, offset + Number(limit) - 1)
    if (search || q) query = query.or(`question.ilike.%${search || q}%,answer.ilike.%${search || q}%`)
    const { data, count, error } = await query
    if (error) throw error
    return res.status(200).json(paginated(data, count, page, limit))
  } catch (err) { next(err) }
}

const createFaq = makeCreate('faqs')
const updateFaq = makeUpdate('faqs')
const deleteFaq = makeHardDelete('faqs')

// ─────────────────────────────────────────────────────────────
// COUPONS
// ─────────────────────────────────────────────────────────────
async function getCoupons(req, res, next) {
  try {
    const { page = 1, limit = 20, search, q } = req.query
    const offset = (Number(page) - 1) * Number(limit)
    let query = supabase
      .from('coupons')
      .select('id, code, description, type, value, min_order_amount, max_uses, used_count, valid_from, valid_until, is_active, created_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + Number(limit) - 1)
    if (search || q) query = query.or(`code.ilike.%${search || q}%,description.ilike.%${search || q}%`)
    const { data, count, error } = await query
    if (error) throw error
    return res.status(200).json(paginated(data, count, page, limit))
  } catch (err) { next(err) }
}

const createCoupon = makeCreate('coupons')
const updateCoupon = makeUpdate('coupons')
const deleteCoupon = makeHardDelete('coupons')

// ─────────────────────────────────────────────────────────────
// CONTACT MESSAGES
// ─────────────────────────────────────────────────────────────
async function getContacts(req, res, next) {
  try {
    const { page = 1, limit = 20, status, search, q } = req.query
    const offset = (Number(page) - 1) * Number(limit)
    let query = supabase
      .from('contact_messages')
      .select('id, name, email, phone, subject, message, type, status, created_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + Number(limit) - 1)
    if (status)      query = query.eq('status', status)
    if (search || q) query = query.or(`name.ilike.%${search || q}%,email.ilike.%${search || q}%,subject.ilike.%${search || q}%`)
    const { data, count, error } = await query
    if (error) throw error
    return res.status(200).json(paginated(data, count, page, limit))
  } catch (err) { next(err) }
}

async function updateContact(req, res, next) {
  try {
    const { status, assigned_to } = req.body
    const { data, error } = await supabase.from('contact_messages').update({ status, assigned_to }).eq('id', req.params.id).select().single()
    if (error) throw error
    return res.status(200).json({ success: true, item: data })
  } catch (err) { next(err) }
}

const deleteContact = makeHardDelete('contact_messages')

// ─────────────────────────────────────────────────────────────
// SUBSCRIPTIONS
// ─────────────────────────────────────────────────────────────
async function getSubscriptions(req, res, next) {
  try {
    const { page = 1, limit = 20, status } = req.query
    const offset = (Number(page) - 1) * Number(limit)
    let query = supabase
      .from('subscriptions')
      .select(`id, plan_name, status, amount, billing_cycle, started_at, expires_at, cancelled_at, features, created_at, profiles!subscriptions_client_id_fkey ( full_name, email )`, { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + Number(limit) - 1)
    if (status) query = query.eq('status', status)
    const { data, count, error } = await query
    if (error) throw error
    const items = (data || []).map(s => ({ ...s, client_name: s.profiles?.full_name || null }))
    return res.status(200).json(paginated(items, count, page, limit))
  } catch (err) { next(err) }
}

async function updateSubscription(req, res, next) {
  try {
    const { status } = req.body
    const update = { status }
    if (status === 'cancelled') update.cancelled_at = new Date().toISOString()
    const { data, error } = await supabase.from('subscriptions').update(update).eq('id', req.params.id).select().single()
    if (error) throw error
    return res.status(200).json({ success: true, item: data })
  } catch (err) { next(err) }
}

// ─────────────────────────────────────────────────────────────
// SITE SETTINGS
// ─────────────────────────────────────────────────────────────
async function getSettings(req, res, next) {
  try {
    const { data, error } = await supabase.from('site_settings').select('key, value, updated_at').order('key', { ascending: true })
    if (error) throw error
    return res.status(200).json({ success: true, settings: data || [] })
  } catch (err) { next(err) }
}

async function updateSetting(req, res, next) {
  try {
    let { value } = req.body
    try { value = JSON.parse(value) } catch { /* keep as string */ }
    const { data, error } = await supabase
      .from('site_settings')
      .upsert({ key: req.params.id, value, updated_at: new Date().toISOString() }, { onConflict: 'key' })
      .select().single()
    if (error) throw error
    return res.status(200).json({ success: true, item: data })
  } catch (err) { next(err) }
}

// ─────────────────────────────────────────────────────────────
// THERAPIST PORTAL
// ─────────────────────────────────────────────────────────────
async function getMyTherapistAppointments(req, res, next) {
  try {
    const userId = req.user?.sub || req.user?.id
    if (!userId) return res.status(401).json({ message: 'Not authenticated.' })

    const { data: therapistRecord, error: te } = await supabase.from('therapists').select('id').eq('user_id', userId).maybeSingle()
    if (te) return res.status(500).json({ message: 'Database error.' })
    if (!therapistRecord) return res.status(200).json({ appointments: [], warning: 'Therapist profile not found.' })

    const limit = Math.min(parseInt(req.query.limit) || 50, 200)
    const { status, from, to } = req.query

    let query = supabase
      .from('appointments')
      .select(`
        id, scheduled_at, duration_minutes, type, status,
        notes, meeting_link, cancellation_reason, created_at, client_id,
        clients:profiles!appointments_client_id_fkey ( id, full_name, email, phone, avatar_url, date_of_birth, gender, city )
      `)
      .eq('therapist_id', therapistRecord.id)
      .order('scheduled_at', { ascending: false })
      .limit(limit)

    if (status) query = query.eq('status', status)
    if (from)   query = query.gte('scheduled_at', from)
    if (to)     query = query.lte('scheduled_at', to)

    const { data: appointments, error: ae } = await query
    if (ae) return res.status(500).json({ message: 'Could not load appointments.' })
    return res.status(200).json({ appointments: appointments || [] })
  } catch (err) { next(err) }
}

// ─── GROUP SESSIONS ADMIN CRUD ───────────────────────────────────────────────

const adminGetSessions = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, group_id } = req.query
    const offset = (Number(page) - 1) * Number(limit)

    let query = supabase
      .from('group_sessions')
      .select(`
        id, title, facilitator, description,
        scheduled_at, duration_minutes, mode,
        max_spots, price, reserved_count,
        is_full, group_id,
        created_at, updated_at,
        community_groups ( id, name, emoji )
      `, { count: 'exact' })
      .order('scheduled_at', { ascending: false })
      .range(offset, offset + Number(limit) - 1)

    if (group_id) query = query.eq('group_id', group_id)

    const { data, error, count } = await query
    if (error) throw error

    const items = (data || []).map(s => ({
      ...s,
      reserved_count: s.reserved_count || 0,
      spots_left: Math.max(0, (s.max_spots || 0) - (s.reserved_count || 0)),
      is_full: (s.reserved_count || 0) >= (s.max_spots || 0),
    }))

    res.json({
      items,
      pagination: {
        total: count || 0,
        page:  Number(page),
        limit: Number(limit),
      },
    })
  } catch (err) { next(err) }
}

const adminCreateSessionFull = async (req, res, next) => {
  try {
    const {
      group_id, title, facilitator, description,
      scheduled_at, duration_minutes, mode, max_spots, price,
    } = req.body

    if (!group_id)          return res.status(400).json({ message: 'group_id is required' })
    if (!title?.trim())     return res.status(400).json({ message: 'title is required' })
    if (!facilitator?.trim()) return res.status(400).json({ message: 'facilitator is required' })
    if (!scheduled_at)      return res.status(400).json({ message: 'scheduled_at is required' })

    const { data, error } = await supabase
      .from('group_sessions')
      .insert({
        group_id,
        title:            title.trim(),
        facilitator:      facilitator.trim(),
        description:      description || null,
        scheduled_at:     new Date(scheduled_at).toISOString(),
        duration_minutes: Number(duration_minutes) || 60,
        mode:             mode || 'Online (Zoom)',
        max_spots:        Number(max_spots) || 20,
        price:            Number(price) || 0,
        reserved_count:   0,
      })
      .select(`*, community_groups ( id, name, emoji )`)
      .single()

    if (error) throw error
    res.status(201).json({ session: data })
  } catch (err) { next(err) }
}

const adminUpdateSession = async (req, res, next) => {
  try {
    const { id } = req.params
    const {
      group_id, title, facilitator, description,
      scheduled_at, duration_minutes, mode, max_spots, price,
    } = req.body

    const updates = { updated_at: new Date().toISOString() }
    if (group_id         != null) updates.group_id         = group_id
    if (title            != null) updates.title            = title.trim()
    if (facilitator      != null) updates.facilitator      = facilitator.trim()
    if (description      != null) updates.description      = description
    if (scheduled_at     != null) updates.scheduled_at     = new Date(scheduled_at).toISOString()
    if (duration_minutes != null) updates.duration_minutes = Number(duration_minutes)
    if (mode             != null) updates.mode             = mode
    if (max_spots        != null) updates.max_spots        = Number(max_spots)
    if (price            != null) updates.price            = Number(price)

    const { data, error } = await supabase
      .from('group_sessions')
      .update(updates)
      .eq('id', id)
      .select(`*, community_groups ( id, name, emoji )`)
      .single()

    if (error) throw error
    if (!data)  return res.status(404).json({ message: 'Session not found' })
    res.json({ session: data })
  } catch (err) { next(err) }
}

const adminDeleteSession = async (req, res, next) => {
  try {
    const { error } = await supabase
      .from('group_sessions')
      .delete()
      .eq('id', req.params.id)

    if (error) throw error
    res.json({ success: true })
  } catch (err) { next(err) }
}

const adminGetReservations = async (req, res, next) => {
  try {
    const { session_id, limit = 100, page = 1 } = req.query
    const offset = (Number(page) - 1) * Number(limit)

    let query = supabase
      .from('group_reservations')
      .select(`
        id, session_id, user_id, display_name, is_anonymous,
        payment_method, payment_reference, payment_status,
        payment_amount, payment_id, confirmed_at, created_at, status,
        group_sessions (
          id, title, scheduled_at, mode, price, max_spots, reserved_count,
          community_groups ( id, name, emoji )
        )
      `, { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + Number(limit) - 1)

    if (session_id) query = query.eq('session_id', session_id)

    const { data, error, count } = await query
    if (error) throw error

    res.json({
      items: data || [],
      pagination: { total: count || 0, page: Number(page), limit: Number(limit) },
    })
  } catch (err) { next(err) }
}
// ─────────────────────────────────────────────────────────────
// ASSESSMENTS
// ─────────────────────────────────────────────────────────────
async function getAssessments(req, res, next) {
  try {
    const { page = 1, limit = 20 } = req.query
    const offset = (Number(page) - 1) * Number(limit)
    const { data, count, error } = await supabase
      .from('assessments')
      .select('id, title, slug, description, type, is_active, is_free, created_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + Number(limit) - 1)
    if (error) throw error
    return res.status(200).json(paginated(data, count, page, limit))
  } catch (err) { next(err) }
}
const createAssessment = makeCreate('assessments')
const updateAssessment = makeUpdate('assessments')
const deleteAssessment = makeSoftDelete('assessments')

// ─────────────────────────────────────────────────────────────
// COMMUNITY GROUPS
// ─────────────────────────────────────────────────────────────
async function getCommunityGroups(req, res, next) {
  try {
    const { page = 1, limit = 20, search, q } = req.query
    const offset = (Number(page) - 1) * Number(limit)
    let query = supabase
      .from('community_groups')
      .select('id, name, description, emoji, tags, color, is_active, membership_fee, created_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + Number(limit) - 1)
    if (search || q) query = query.or(`name.ilike.%${search || q}%`)
    const { data, count, error } = await query
    if (error) throw error
    return res.status(200).json(paginated(data, count, page, limit))
  } catch (err) { next(err) }
}
const createCommunityGroup = makeCreate('community_groups')
const updateCommunityGroup = makeUpdate('community_groups')
const deleteCommunityGroup = makeSoftDelete('community_groups')

async function adminGetCommunityGroups(req, res, next) {
  try {
    const { page = 1, limit = 20 } = req.query
    const offset = (Number(page) - 1) * Number(limit)
    const { data, count, error } = await supabase
      .from('community_groups')
      .select('id, name, description, emoji, tags, color, is_active, membership_fee, created_at, group_memberships ( count )', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + Number(limit) - 1)
    if (error) throw error
    const groups = (data || []).map(g => ({ ...g, member_count: g.group_memberships?.[0]?.count ?? 0, group_memberships: undefined }))
    return res.status(200).json(paginated(groups, count, page, limit))
  } catch (err) { next(err) }
}

async function adminUpdateReservation(req, res, next) {
  try {
    const allowed = ['payment_status', 'confirmed_at', 'status', 'cancelled_at']
    const update = {}
    allowed.forEach(k => { if (req.body[k] !== undefined) update[k] = req.body[k] })
    const { data, error } = await supabase
      .from('group_session_reservations').update(update).eq('id', req.params.id).select().single()
    if (error) throw error
    return res.status(200).json({ success: true, item: data })
  } catch (err) { next(err) }
}

async function adminDeleteReservation(req, res, next) {
  try {
    const { error } = await supabase
      .from('group_session_reservations')
      .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
      .eq('id', req.params.id)
    if (error) throw error
    return res.status(200).json({ success: true })
  } catch (err) { next(err) }
}

async function adminGetMemberships(req, res, next) {
  try {
    const { group_id, page = 1, limit = 50 } = req.query
    const offset = (Number(page) - 1) * Number(limit)
    let query = supabase
      .from('group_memberships')
      .select('id, group_id, user_id, display_name, is_anonymous, email, payment_status, payment_method, payment_reference, payment_amount, payment_id, community_groups ( id, name, emoji, membership_fee )', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + Number(limit) - 1)
    if (group_id) query = query.eq('group_id', group_id)
    const { data, count, error } = await query
    if (error) throw error
    return res.status(200).json(paginated(data, count, page, limit))
  } catch (err) { next(err) }
}
// ─────────────────────────────────────────────────────────────
// SMS
// ─────────────────────────────────────────────────────────────
const SMS_TEMPLATES = {
  customer: [
    { id: 'order_placed',    label: 'Order Placed',     text: 'Hi {name}, your order {order_number} has been placed. - Common Psychology' },
    { id: 'order_shipped',   label: 'Out for Delivery',  text: 'Hi {name}, your order {order_number} is out for delivery.' },
    { id: 'order_delivered', label: 'Order Delivered',   text: 'Hi {name}, your order {order_number} has been delivered. Thank you!' },
  ],
  staff: [
    { id: 'shift_reminder', label: 'Shift Reminder', text: 'Hi {name}, reminder: your shift starts at {time} today.' },
    { id: 'meeting',        label: 'Meeting Notice',  text: 'Hi {name}, staff meeting on {date} at {time}.' },
  ],
  rider: [
    { id: 'order_assigned', label: 'Order Assigned', text: 'Hi {name}, delivery {order_number} has been assigned to you.' },
    { id: 'urgent',         label: 'Urgent Delivery', text: 'Hi {name}, order {order_number} needs urgent delivery.' },
  ],
  therapist: [
    { id: 'appt_reminder',  label: 'Appointment Reminder',  text: 'Hi {name}, appointment with {client_name} on {date} at {time}.' },
    { id: 'appt_cancelled', label: 'Appointment Cancelled', text: 'Hi {name}, appointment with {client_name} on {date} was cancelled.' },
  ],
}

// Mirrors the two-step user_id → profiles join pattern already used in getTherapists()
async function fetchSmsRecipients(role, { search, ids } = {}) {
  if (role === 'customer' || role === 'staff') {
    const dbRole = role === 'customer' ? 'client' : 'staff'
    let query = supabase.from('profiles').select('id, full_name, phone').eq('role', dbRole).not('phone', 'is', null)
    if (ids)    query = query.in('id', ids)
    if (search) query = query.or(`full_name.ilike.%${search}%,phone.ilike.%${search}%`)
    const { data, error } = await query
    if (error) throw error
    return data || []
  }

  if (role === 'rider') {
    let query = supabase.from('delivery_riders').select('id, user_id, area')
    if (ids) query = query.in('id', ids)
    const { data: riders, error } = await query
    if (error) throw error
    if (!riders?.length) return []

    const userIds = riders.map(r => r.user_id).filter(Boolean)
    const { data: profiles, error: pe } = await supabase
      .from('profiles').select('id, full_name, phone').in('id', userIds).not('phone', 'is', null)
    if (pe) throw pe

    const map = {}
    ;(profiles || []).forEach(p => { map[p.id] = p })

    let rows = riders
      .filter(r => map[r.user_id]?.phone)
      .map(r => ({ id: r.id, full_name: map[r.user_id].full_name || r.area || '—', phone: map[r.user_id].phone }))
    if (search) rows = rows.filter(r => r.full_name.toLowerCase().includes(search.toLowerCase()) || r.phone.includes(search))
    return rows
  }

  if (role === 'therapist') {
    let query = supabase.from('therapists').select('id, user_id')
    if (ids) query = query.in('id', ids)
    const { data: therapists, error } = await query
    if (error) throw error
    if (!therapists?.length) return []

    const userIds = therapists.map(t => t.user_id).filter(Boolean)
    const { data: profiles, error: pe } = await supabase
      .from('profiles').select('id, full_name, phone').in('id', userIds).not('phone', 'is', null)
    if (pe) throw pe

    const map = {}
    ;(profiles || []).forEach(p => { map[p.id] = p })

    let rows = therapists
      .filter(t => map[t.user_id]?.phone)
      .map(t => ({ id: t.id, full_name: map[t.user_id].full_name, phone: map[t.user_id].phone }))
    if (search) rows = rows.filter(r => r.full_name.toLowerCase().includes(search.toLowerCase()) || r.phone.includes(search))
    return rows
  }

  throw new Error('Invalid role')
}

async function getSmsTemplates(req, res, next) {
  try { return res.status(200).json(SMS_TEMPLATES) } catch (err) { next(err) }
}

async function getSmsRecipients(req, res, next) {
  try {
    const { role, search } = req.query
    const rows = await fetchSmsRecipients(role, { search })
    const items = rows.map(r => ({ id: r.id, name: r.full_name, phone: r.phone }))
    return res.status(200).json({ success: true, items })
  } catch (err) { next(err) }
}

async function sendAdminSms(req, res, next) {
  try {
    const { mode, role, recipient_ids, message } = req.body
    if (!message?.trim()) return res.status(400).json({ success: false, message: 'Message text is required.' })

    const targets = await fetchSmsRecipients(role, { ids: mode === 'select' ? (recipient_ids || []) : undefined })
    if (!targets.length) return res.status(400).json({ success: false, message: 'No valid phone numbers found.' })

    const phoneList = targets.map(t => String(t.phone).replace(/\D/g, ''))
    const result = await sendSparrowSms(phoneList, message)

    const { error: le } = await supabase.from('sms_logs').insert({
      sent_by: req.user?.sub || req.user?.id || null,
      role,
      recipient_count: targets.length,
      message,
      provider_response: result,
    })
    if (le) console.error('sms_logs insert failed:', le.message)

    return res.status(200).json({ success: true, sent: targets.length, result })
  } catch (err) { next(err) }
}

async function getSmsLogs(req, res, next) {
  try {
    const { data, error } = await supabase
      .from('sms_logs').select('*').order('created_at', { ascending: false }).limit(100)
    if (error) throw error
    return res.status(200).json({ success: true, items: data || [] })
  } catch (err) { next(err) }
}

// ─────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────
module.exports = {
  getDashboard,
  registerStaff,

 
  // users
  getUsers, toggleUserActive, setUserStatus, setUserRole,

  // appointments
  getAllAppointments, setAppointmentStatus,

  // orders
  getAllOrders, setOrderStatus,

  // payments
  getPayments, updatePaymentStatus,
  getAllPayments: getAllPaymentsAdmin,

  // notifications
  sendNotificationToClient,

  // products
  getProducts, createProduct, updateProduct, deleteProduct,

  // blog posts
  getPosts, createPost, updatePost, deletePost,

  // news
  getNews, createNews, updateNews, deleteNews,

  // resources
  getResources, createResource, updateResource, deleteResource,

  // gallery
  getGallery, createGalleryItem, updateGalleryItem, deleteGalleryItem,

  // research
  getResearch, createResearch, updateResearch, deleteResearch,

  // psych videos
  getPsychVideos, createPsychVideo, updatePsychVideo, deletePsychVideo,

  // psych analyses
  getPsychAnalyses, createPsychAnalysis, updatePsychAnalysis, deletePsychAnalysis,

  // psych concepts
  getPsychConcepts, createPsychConcept, updatePsychConcept, deletePsychConcept,

  // courses
  getCourses, createCourse, updateCourse, deleteCourse,

  // therapists
  getTherapists, createTherapist, updateTherapist, deleteTherapist,

  // assessments
  getAssessments, createAssessment, updateAssessment, deleteAssessment,

  // community groups (simple CRUD)
  getCommunityGroups, createCommunityGroup, updateCommunityGroup, deleteCommunityGroup,

  // community admin
  adminGetCommunityGroups,
  adminGetSessions, adminCreateSessionFull, adminUpdateSession, adminDeleteSession,
  adminGetReservations, adminUpdateReservation, adminDeleteReservation,
  adminGetMemberships,

  // faqs
  getFaqs, createFaq, updateFaq, deleteFaq,

  // coupons
  getCoupons, createCoupon, updateCoupon, deleteCoupon,

  // contacts
  getContacts, updateContact, deleteContact,

  // subscriptions
  getSubscriptions, updateSubscription,

  // settings
  getSettings, updateSetting,

  // therapist portal
  getMyTherapistAppointments,

  // social work
  // social work
  getSocialWorkPrograms, createSocialWorkProgram, updateSocialWorkProgram, deleteSocialWorkProgram,
  getPublicSocialWorkPrograms,

  // sms
  getSmsTemplates, getSmsRecipients, sendAdminSms, getSmsLogs,

}