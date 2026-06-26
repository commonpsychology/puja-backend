// src/routes/controllers/communityController.js — COMPLETE FIXED VERSION
// Changes from previous version:
//   1. Added adminListMemberships  — queries joined_at (NOT created_at, which doesn't exist)
//   2. Added adminUpdateMembership — handles PUT /admin/group-memberships/:id
//   3. Added adminDeleteMembership — handles DELETE /admin/group-memberships/:id
//   4. adminGetSessions now returns { items, pagination } so frontend .items works
//   5. Updated module.exports to export all three new functions

const supabase = require('../../db/supabase')

// ── helpers ───────────────────────────────────────────────────
function pg(req) {
  const page  = Math.max(1, Number(req.query.page)  || 1)
  const limit = Math.min(100, Number(req.query.limit) || 20)
  return { page, limit, offset: (page - 1) * limit }
}

// ═══════════════════════════════════════════════════════════════
// GROUPS
// ═══════════════════════════════════════════════════════════════

async function listGroups(req, res, next) {
  try {
    const { data, error } = await supabase
      .from('community_groups')
      .select(`
        id, name, description, emoji, tags, color, created_at,
        membership_fee, membership_period, next_session_at,
        group_memberships ( count )
      `)
      .eq('is_active', true)
      .order('created_at', { ascending: true })

    if (error) throw error

    const groups = (data || []).map(g => ({
      ...g,
      member_count: g.group_memberships?.[0]?.count ?? 0,
      group_memberships: undefined,
    }))

    return res.json({ success: true, groups })
  } catch (err) { next(err) }
}

async function getGroup(req, res, next) {
  try {
    const { data, error } = await supabase
      .from('community_groups')
      .select(`
        id, name, description, emoji, tags, color, created_at,
        membership_fee, membership_period, next_session_at,
        group_memberships ( count )
      `)
      .eq('id', req.params.id)
      .eq('is_active', true)
      .single()

    if (error) throw error
    return res.json({ success: true, group: { ...data, member_count: data.group_memberships?.[0]?.count ?? 0 } })
  } catch (err) { next(err) }
}

async function joinGroup(req, res, next) {
  try {
    const {
      display_name, is_anonymous, email,
      payment_status, payment_method, payment_reference, payment_amount, payment_id,
    } = req.body
    const groupId = req.params.id
    const userId  = req.user?.sub || null

    const { data, error } = await supabase
      .from('group_memberships')
      .upsert({
        group_id:          groupId,
        user_id:           userId,
        display_name:      is_anonymous ? 'Anonymous' : (display_name || 'Member'),
        is_anonymous:      !!is_anonymous,
        email:             is_anonymous ? null : (email || null),
        payment_status:    payment_status    || 'pending',
        payment_method:    payment_method    || null,
        payment_reference: payment_reference || null,
        payment_amount:    payment_amount    || null,
        payment_id:        payment_id        || null,
      }, { onConflict: 'group_id,user_id', ignoreDuplicates: false })
      .select()
      .single()

    if (error) throw error
    return res.status(201).json({ success: true, membership: data })
  } catch (err) { next(err) }
}

async function leaveGroup(req, res, next) {
  try {
    const userId = req.user?.sub
    if (!userId) return res.status(401).json({ success: false, message: 'Not authenticated.' })

    const { error } = await supabase
      .from('group_memberships')
      .delete()
      .eq('group_id', req.params.id)
      .eq('user_id', userId)

    if (error) throw error
    return res.json({ success: true })
  } catch (err) { next(err) }
}

async function checkMembership(req, res, next) {
  try {
    const userId = req.user?.sub
    if (!userId) return res.json({ success: true, isMember: false })

    const { data } = await supabase
      .from('group_memberships')
      .select('id')
      .eq('group_id', req.params.id)
      .eq('user_id', userId)
      .maybeSingle()

    return res.json({ success: true, isMember: !!data })
  } catch (err) { next(err) }
}

async function myGroups(req, res, next) {
  try {
    const userId = req.user?.sub
    if (!userId) return res.json({ success: true, groupIds: [], memberships: [] })

    const { data, error } = await supabase
      .from('group_memberships')
      .select(`
        id, group_id, payment_status, payment_method, payment_reference, payment_amount,
        community_groups ( id, name, emoji, membership_fee, membership_period )
      `)
      .eq('user_id', userId)

    if (error) throw error

    const memberships = data || []
    return res.json({
      success: true,
      groupIds: memberships.map(m => m.group_id),
      memberships,
    })
  } catch (err) { next(err) }
}

// ═══════════════════════════════════════════════════════════════
// SESSIONS
// ═══════════════════════════════════════════════════════════════

async function listSessions(req, res, next) {
  try {
    const { data, error } = await supabase
      .from('v_group_sessions')
      .select('*')
      .order('scheduled_at', { ascending: true })

    if (error) throw error
    return res.json({ success: true, sessions: data || [] })
  } catch (err) { next(err) }
}

async function reserveSession(req, res, next) {
  try {
    const {
      display_name, is_anonymous, payment_method, payment_reference,
      payment_status: clientStatus, payment_amount: clientAmount, payment_id,
    } = req.body
    const sessionId = req.params.id
    const userId    = req.user?.sub || null

    const { data: sess, error: sErr } = await supabase
      .from('group_sessions')
      .select('max_spots, reserved_count, price')
      .eq('id', sessionId)
      .single()

    if (sErr) throw sErr
    if ((sess.reserved_count ?? 0) >= sess.max_spots)
      return res.status(409).json({ success: false, message: 'No spots remaining for this session.' })

    const isFree         = !sess.price || Number(sess.price) === 0
    const payment_status = clientStatus || (isFree ? 'free' : (payment_method ? 'pending' : 'unpaid'))
    const payment_amount = clientAmount || (isFree ? null : (sess.price || null))

    const { data, error } = await supabase
      .from('group_session_reservations')
      .insert({
        session_id:        sessionId,
        user_id:           userId,
        display_name:      is_anonymous ? 'Anonymous' : (display_name || 'Guest'),
        is_anonymous:      !!is_anonymous,
        payment_method:    payment_method    || null,
        payment_reference: payment_reference || null,
        payment_status,
        payment_amount,
        payment_id:        payment_id        || null,
      })
      .select()
      .single()

    if (error) throw error
    return res.status(201).json({ success: true, reservation: data })
  } catch (err) { next(err) }
}

async function cancelReservation(req, res, next) {
  try {
    const userId = req.user?.sub
    if (!userId) return res.status(401).json({ success: false, message: 'Not authenticated.' })

    const { error } = await supabase
      .from('group_session_reservations')
      .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
      .eq('session_id', req.params.id)
      .eq('user_id', userId)

    if (error) throw error
    return res.json({ success: true })
  } catch (err) { next(err) }
}

async function myReservations(req, res, next) {
  try {
    const userId = req.user?.sub
    if (!userId) return res.json({ success: true, reservations: [] })

    const { data, error } = await supabase
      .from('group_session_reservations')
      .select(`
        id, session_id, payment_status, payment_method,
        payment_reference, payment_amount, payment_id,
        confirmed_at, status, created_at,
    group_sessions!group_sessions_group_id_fkey ( id, title, scheduled_at, mode, facilitator, price,
          community_groups!group_sessions_group_id_fkey ( name, emoji, membership_fee ) )
      `)
      .eq('user_id', userId)
      .eq('status', 'active')
      .order('created_at', { ascending: false })

    if (error) throw error
    return res.json({
      success: true,
      reservations: data || [],
      sessionIds: (data || []).map(r => r.session_id),
    })
  } catch (err) { next(err) }
}

// ═══════════════════════════════════════════════════════════════
// POSTS
// ═══════════════════════════════════════════════════════════════

async function listPosts(req, res, next) {
  try {
    const { group_id } = req.query
    const { page, limit, offset } = pg(req)

    let query = supabase
      .from('community_posts')
      .select(`
        id, group_id, display_name, is_anonymous, content, created_at,
        community_groups ( name, emoji ),
        post_likes ( count )
      `, { count: 'exact' })
      .eq('is_approved', true)
      .eq('is_deleted', false)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (group_id) query = query.eq('group_id', group_id)

    const { data, count, error } = await query
    if (error) throw error

    const posts = (data || []).map(p => ({
      ...p,
      like_count: p.post_likes?.[0]?.count ?? 0,
      post_likes: undefined,
    }))

    return res.json({ success: true, posts, pagination: { page, limit, total: count } })
  } catch (err) { next(err) }
}

async function createPost(req, res, next) {
  try {
    const { group_id, content, display_name, is_anonymous } = req.body
    const userId = req.user?.sub || null

    if (!content?.trim())
      return res.status(400).json({ success: false, message: 'Post content is required.' })
    if (!group_id)
      return res.status(400).json({ success: false, message: 'group_id is required.' })

    const { data: group, error: gErr } = await supabase
      .from('community_groups')
      .select('id')
      .eq('id', group_id)
      .eq('is_active', true)
      .maybeSingle()

    if (gErr || !group)
      return res.status(404).json({ success: false, message: 'Group not found.' })

    const { data, error } = await supabase
      .from('community_posts')
      .insert({
        group_id,
        user_id:      userId,
        display_name: is_anonymous ? 'Anonymous' : (display_name?.trim() || 'Member'),
        is_anonymous: !!is_anonymous,
        content:      content.trim(),
        is_approved:  true,
      })
      .select(`
        id, group_id, display_name, is_anonymous, content, created_at,
        community_groups ( name, emoji )
      `)
      .single()

    if (error) throw error
    return res.status(201).json({ success: true, post: { ...data, like_count: 0 } })
  } catch (err) { next(err) }
}

async function likePost(req, res, next) {
  try {
    const postId     = req.params.id
    const userId     = req.user?.sub || null
    const sessionKey = req.body.session_key || null

    let existing
    if (userId) {
      const { data } = await supabase
        .from('post_likes').select('id').eq('post_id', postId).eq('user_id', userId).maybeSingle()
      existing = data
    }

    if (existing) {
      await supabase.from('post_likes').delete().eq('id', existing.id)
      return res.json({ success: true, liked: false })
    }

    await supabase.from('post_likes').insert({ post_id: postId, user_id: userId, session_key: sessionKey })
    return res.json({ success: true, liked: true })
  } catch (err) { next(err) }
}

async function deletePost(req, res, next) {
  try {
    const userId = req.user?.sub
    const role   = req.user?.role

    const { data: post } = await supabase
      .from('community_posts').select('user_id').eq('id', req.params.id).single()
    if (!post) return res.status(404).json({ success: false, message: 'Post not found.' })

    if (post.user_id !== userId && !['admin', 'staff'].includes(role))
      return res.status(403).json({ success: false, message: 'Not authorized.' })

    await supabase.from('community_posts').update({ is_deleted: true }).eq('id', req.params.id)
    return res.json({ success: true })
  } catch (err) { next(err) }
}

// ═══════════════════════════════════════════════════════════════
// APPOINTMENT NOTES
// ═══════════════════════════════════════════════════════════════

async function getAppointmentNote(req, res, next) {
  try {
    const therapistUserId = req.user?.sub

    const { data: therapistRecord } = await supabase
      .from('therapists').select('id').eq('user_id', therapistUserId).single()
    if (!therapistRecord)
      return res.status(404).json({ success: false, message: 'Therapist profile not found.' })

    const { data, error } = await supabase
      .from('appointment_notes')
      .select('id, content, updated_at')
      .eq('appointment_id', req.params.id)
      .eq('therapist_id', therapistUserId)
      .maybeSingle()

    if (error) throw error
    return res.json({ success: true, note: data || null })
  } catch (err) { next(err) }
}

async function upsertAppointmentNote(req, res, next) {
  try {
    const { content } = req.body
    const therapistUserId = req.user?.sub

    if (!content?.trim())
      return res.status(400).json({ success: false, message: 'Note content is required.' })

    const { data, error } = await supabase
      .from('appointment_notes')
      .upsert({
        appointment_id: req.params.id,
        therapist_id:   therapistUserId,
        content:        content.trim(),
        updated_at:     new Date().toISOString(),
      }, { onConflict: 'appointment_id,therapist_id' })
      .select('id, content, updated_at')
      .single()

    if (error) throw error
    return res.json({ success: true, note: data })
  } catch (err) { next(err) }
}

// ═══════════════════════════════════════════════════════════════
// ADMIN — community management
// ═══════════════════════════════════════════════════════════════

async function adminListGroups(req, res, next) {
  try {
    const { data, error } = await supabase
      .from('community_groups')
      .select(`
        id, name, description, emoji, tags, is_active, created_at,
        membership_fee, membership_period,
        group_memberships ( count )
      `)
      .order('created_at', { ascending: true })

    if (error) throw error
    const groups = (data || []).map(g => ({
      ...g,
      member_count: g.group_memberships?.[0]?.count ?? 0,
      group_memberships: undefined,
    }))
    return res.json({ success: true, groups, items: groups })
  } catch (err) { next(err) }
}

async function adminCreateGroup(req, res, next) {
  try {
    const { name, description, emoji, tags, membership_fee, membership_period } = req.body
    if (!name?.trim()) return res.status(400).json({ success: false, message: 'Name is required.' })

    const { data, error } = await supabase
      .from('community_groups')
      .insert({
        name:              name.trim(),
        description:       description?.trim(),
        emoji:             emoji || '💙',
        tags:              tags || [],
        membership_fee:    membership_fee    ?? 0,
        membership_period: membership_period || 'one_time',
        created_by:        req.user?.sub,
      })
      .select()
      .single()

    if (error) throw error
    return res.status(201).json({ success: true, group: data })
  } catch (err) { next(err) }
}

async function adminToggleGroup(req, res, next) {
  try {
    const { data: current } = await supabase
      .from('community_groups').select('is_active').eq('id', req.params.id).single()
    const { data, error } = await supabase
      .from('community_groups').update({ is_active: !current.is_active })
      .eq('id', req.params.id).select().single()
    if (error) throw error
    return res.json({ success: true, group: data })
  } catch (err) { next(err) }
}

// ✅ FIXED: returns { items, pagination } so AdminDashboardPage.jsx
//    (which reads d.items) gets the data correctly.
//    Previously returned { sessions } which the frontend never read.
async function adminListSessions(req, res, next) {
  try {
    const { page, limit, offset } = pg(req)

    const { data, count, error } = await supabase
      .from('v_group_sessions')
      .select('*', { count: 'exact' })
      .order('scheduled_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (error) throw error
    return res.json({
      success: true,
      items: data || [],
      sessions: data || [],           // keep for backward compat
      pagination: { page, limit, total: count ?? (data || []).length },
    })
  } catch (err) { next(err) }
}

async function adminCreateSession(req, res, next) {
  try {
    const { title, facilitator, mode, scheduled_at, max_spots, group_id, notes, price } = req.body
    if (!title || !facilitator || !scheduled_at)
      return res.status(400).json({ success: false, message: 'title, facilitator and scheduled_at are required.' })

    const { data, error } = await supabase
      .from('group_sessions')
      .insert({
        title, facilitator,
        mode:       mode       || 'Online (Zoom)',
        scheduled_at,
        max_spots:  max_spots  || 20,
        group_id:   group_id   || null,
        notes:      notes      || null,
        price:      price      || 0,
        created_by: req.user?.sub,
      })
      .select()
      .single()

    if (error) throw error
    return res.status(201).json({ success: true, session: data })
  } catch (err) { next(err) }
}

async function adminListPosts(req, res, next) {
  try {
    const { page, limit, offset } = pg(req)
    const { data, count, error } = await supabase
      .from('community_posts')
      .select(`
        id, display_name, content, is_approved, is_deleted, is_anonymous, created_at,
        community_groups ( name ),
        post_likes ( count )
      `, { count: 'exact' })
      .eq('is_deleted', false)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (error) throw error
    return res.json({ success: true, posts: data, pagination: { page, limit, total: count } })
  } catch (err) { next(err) }
}

async function adminModeratePost(req, res, next) {
  try {
    const { is_approved } = req.body
    const { data, error } = await supabase
      .from('community_posts').update({ is_approved }).eq('id', req.params.id).select().single()
    if (error) throw error
    return res.json({ success: true, post: data })
  } catch (err) { next(err) }
}

async function adminDeletePost(req, res, next) {
  try {
    await supabase.from('community_posts').update({ is_deleted: true }).eq('id', req.params.id)
    return res.json({ success: true })
  } catch (err) { next(err) }
}
async function adminListReservations(req, res, next) {
  try {
    const { page, limit, offset } = pg(req)
    let query = supabase
      .from('group_reservations')
      .select(`
        *,
        group_sessions (
          id, title, facilitator, mode, scheduled_at, price, max_spots,
          community_groups ( id, name, emoji )
        )
      `, { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (req.query.session_id) query = query.eq('session_id', req.query.session_id)
    if (req.query.status)     query = query.eq('payment_status', req.query.status)

    const { data, count, error } = await query
    if (error) throw error
    return res.json({
      success: true,
      items: data || [],
      reservations: data || [],
      pagination: { page, limit, total: count ?? 0 },
    })
  } catch (err) { next(err) }
}

// ═══════════════════════════════════════════════════════════════
// ADMIN — MEMBERSHIPS  ✅ ALL NEW
// ═══════════════════════════════════════════════════════════════

// GET /api/admin/group-memberships?limit=100&group_id=<uuid>
// ⚠️  The group_memberships table has NO created_at column.
//     The correct timestamp column is joined_at.
async function adminListMemberships(req, res, next) {
  try {
    const limit   = Math.min(200, Number(req.query.limit) || 100)
    const groupId = req.query.group_id || null

    let query = supabase
      .from('group_memberships')
      .select(`
        id,
        group_id,
        user_id,
        display_name,
        is_anonymous,
        email,
        joined_at,
        payment_status,
        payment_method,
        payment_reference,
        payment_amount,
        payment_id,
        confirmed_at,
        expires_at,
        status,
        community_groups ( id, name, emoji )
      `)
      .order('joined_at', { ascending: false })   // ✅ joined_at — NOT created_at
      .limit(limit)

    if (groupId) query = query.eq('group_id', groupId)

    const { data, error } = await query
    if (error) throw error

    return res.json({ success: true, items: data || [] })
  } catch (err) { next(err) }
}

// PUT /api/admin/group-memberships/:id
async function adminUpdateMembership(req, res, next) {
  try {
    const allowed = [
      'payment_status',
      'confirmed_at',
      'status',
      'expires_at',
      'payment_reference',
      'payment_method',
    ]
    const updates = {}
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key]
    }

    if (Object.keys(updates).length === 0)
      return res.status(400).json({ success: false, message: 'No valid fields to update.' })

    const { data, error } = await supabase
      .from('group_memberships')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .single()

    if (error) throw error
    return res.json({ success: true, membership: data })
  } catch (err) { next(err) }
}

// DELETE /api/admin/group-memberships/:id
async function adminDeleteMembership(req, res, next) {
  try {
    const { error } = await supabase
      .from('group_memberships')
      .delete()
      .eq('id', req.params.id)

    if (error) throw error
    return res.json({ success: true })
  } catch (err) { next(err) }
}
// Add these two to communityController.js

async function adminUpdateGroup(req, res, next) {
  try {
    const allowed = [
      'name', 'description', 'emoji', 'color', 'tags',
      'membership_fee', 'membership_period', 'is_active', 'sort_order',
    ]
    const updates = {}
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key]
    }
    const { data, error } = await supabase
      .from('community_groups')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .single()
    if (error) throw error
    return res.json({ success: true, group: data })
  } catch (err) { next(err) }
}

async function adminDeleteGroup(req, res, next) {
  try {
    const { error } = await supabase
      .from('community_groups')
      .update({ is_active: false })   // soft delete
      .eq('id', req.params.id)
    if (error) throw error
    return res.json({ success: true })
  } catch (err) { next(err) }
}

async function adminUpdateSession(req, res, next) {
  try {
    const allowed = [
      'title', 'facilitator', 'mode', 'scheduled_at',
      'duration_minutes', 'max_spots', 'price', 'description',
      'group_id', 'is_active',
    ]
    const updates = {}
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key]
    }
    const { data, error } = await supabase
      .from('group_sessions')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .single()
    if (error) throw error
    return res.json({ success: true, session: data })
  } catch (err) { next(err) }
}

async function adminDeleteSession(req, res, next) {
  try {
    const { error } = await supabase
      .from('group_sessions').delete().eq('id', req.params.id)
    if (error) throw error
    return res.json({ success: true })
  } catch (err) { next(err) }
}

async function adminUpdateReservation(req, res, next) {
  try {
    const allowed = ['payment_status', 'confirmed_at', 'payment_reference', 'payment_method']
    const updates = {}
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key]
    }
    const { data, error } = await supabase
      .from('group_reservations')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .single()
    if (error) throw error
    return res.json({ success: true, reservation: data })
  } catch (err) { next(err) }
}

async function adminDeleteReservation(req, res, next) {
  try {
    const { error } = await supabase
      .from('group_reservations').delete().eq('id', req.params.id)
    if (error) throw error
    return res.json({ success: true })
  } catch (err) { next(err) }
}
// ─────────────────────────────────────────────────────────────
module.exports = {
  // public
  listGroups, getGroup, joinGroup, leaveGroup, checkMembership, myGroups,
  listSessions, reserveSession, cancelReservation, myReservations,
  listPosts, createPost, likePost, deletePost,
  getAppointmentNote, upsertAppointmentNote,
  // admin
adminListGroups, adminCreateGroup, adminToggleGroup, adminUpdateGroup, adminDeleteGroup,
  adminListSessions, adminCreateSession, adminUpdateSession, adminDeleteSession,  // ← updated
  adminListPosts, adminModeratePost, adminDeletePost,
  adminListReservations, adminUpdateReservation, adminDeleteReservation,  // ← updated
  adminListMemberships, adminUpdateMembership, adminDeleteMembership,
}