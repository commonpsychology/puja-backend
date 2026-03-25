// src/controllers/communityController.js
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

// GET /api/community/groups
async function listGroups(req, res, next) {
  try {
    const { data, error } = await supabase
      .from('community_groups')
      .select(`
        id, name, description, emoji, tags, color, created_at,
        group_memberships ( count )
      `)
      .eq('is_active', true)
      .order('created_at', { ascending: true })

    if (error) throw error

    // Flatten member count
    const groups = (data || []).map(g => ({
      ...g,
      member_count: g.group_memberships?.[0]?.count ?? 0,
      group_memberships: undefined,
    }))

    return res.json({ success: true, groups })
  } catch (err) { next(err) }
}

// GET /api/community/groups/:id
async function getGroup(req, res, next) {
  try {
    const { data, error } = await supabase
      .from('community_groups')
      .select(`
        id, name, description, emoji, tags, color, created_at,
        group_memberships ( count )
      `)
      .eq('id', req.params.id)
      .eq('is_active', true)
      .single()

    if (error) throw error
    return res.json({ success: true, group: { ...data, member_count: data.group_memberships?.[0]?.count ?? 0 } })
  } catch (err) { next(err) }
}

// POST /api/community/groups/:id/join
async function joinGroup(req, res, next) {
  try {
    const { display_name, is_anonymous, email } = req.body
    const groupId = req.params.id
    const userId  = req.user?.sub || null

    const { data, error } = await supabase
      .from('group_memberships')
      .upsert({
        group_id:     groupId,
        user_id:      userId,
        display_name: is_anonymous ? 'Anonymous' : (display_name || 'Member'),
        is_anonymous: !!is_anonymous,
        email:        is_anonymous ? null : (email || null),
      }, { onConflict: 'group_id,user_id', ignoreDuplicates: false })
      .select()
      .single()

    if (error) throw error
    return res.status(201).json({ success: true, membership: data })
  } catch (err) { next(err) }
}

// DELETE /api/community/groups/:id/leave
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

// GET /api/community/groups/:id/membership  — check if current user is member
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

// GET /api/community/my-groups  — all groups joined by current user
async function myGroups(req, res, next) {
  try {
    const userId = req.user?.sub
    if (!userId) return res.json({ success: true, groupIds: [] })

    const { data, error } = await supabase
      .from('group_memberships')
      .select('group_id')
      .eq('user_id', userId)

    if (error) throw error
    return res.json({ success: true, groupIds: (data || []).map(m => m.group_id) })
  } catch (err) { next(err) }
}

// ═══════════════════════════════════════════════════════════════
// SESSIONS
// ═══════════════════════════════════════════════════════════════

// GET /api/community/sessions
async function listSessions(req, res, next) {
  try {
    const { data, error } = await supabase
      .from('group_sessions')
      .select(`
        id, title, facilitator, mode, scheduled_at, max_spots, notes,
        group_id,
        community_groups ( name, emoji ),
        session_reservations ( count )
      `)
      .eq('is_active', true)
      .gte('scheduled_at', new Date().toISOString())
      .order('scheduled_at', { ascending: true })

    if (error) throw error

    const sessions = (data || []).map(s => ({
      ...s,
      reserved_count: s.session_reservations?.[0]?.count ?? 0,
      spots_left: s.max_spots - (s.session_reservations?.[0]?.count ?? 0),
      session_reservations: undefined,
    }))

    return res.json({ success: true, sessions })
  } catch (err) { next(err) }
}

// POST /api/community/sessions/:id/reserve
async function reserveSession(req, res, next) {
  try {
    const { display_name, email, is_anonymous } = req.body
    const sessionId = req.params.id
    const userId    = req.user?.sub || null

    // Check spots
    const { data: sess, error: sErr } = await supabase
      .from('group_sessions')
      .select('max_spots, session_reservations(count)')
      .eq('id', sessionId)
      .single()

    if (sErr) throw sErr
    const taken = sess.session_reservations?.[0]?.count ?? 0
    if (taken >= sess.max_spots)
      return res.status(409).json({ success: false, message: 'No spots remaining for this session.' })

    const { data, error } = await supabase
      .from('session_reservations')
      .upsert({
        session_id:   sessionId,
        user_id:      userId,
        display_name: is_anonymous ? 'Anonymous' : (display_name || 'Guest'),
        email:        is_anonymous ? null : (email || null),
        is_anonymous: !!is_anonymous,
        status:       'confirmed',
      }, { onConflict: 'session_id,user_id', ignoreDuplicates: false })
      .select()
      .single()

    if (error) throw error
    return res.status(201).json({ success: true, reservation: data })
  } catch (err) { next(err) }
}


exports.upsertAppointmentNote = async (req, res) => {
  try {
    const { id } = req.params
    const { note, private_note } = req.body

    const { data, error } = await supabase
      .from('appointment_notes')
      .upsert(
        { appointment_id: id, note, private_note, updated_at: new Date().toISOString() },
        { onConflict: 'appointment_id' }
      )
      .select()
      .single()

    if (error) throw error

    res.json({ success: true, data })
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
}

// DELETE /api/community/sessions/:id/cancel-reservation
async function cancelReservation(req, res, next) {
  try {
    const userId = req.user?.sub
    if (!userId) return res.status(401).json({ success: false, message: 'Not authenticated.' })

    const { error } = await supabase
      .from('session_reservations')
      .update({ status: 'cancelled' })
      .eq('session_id', req.params.id)
      .eq('user_id', userId)

    if (error) throw error
    return res.json({ success: true })
  } catch (err) { next(err) }
}

// GET /api/community/my-reservations
async function myReservations(req, res, next) {
  try {
    const userId = req.user?.sub
    if (!userId) return res.json({ success: true, sessionIds: [] })

    const { data, error } = await supabase
      .from('session_reservations')
      .select('session_id')
      .eq('user_id', userId)
      .eq('status', 'confirmed')

    if (error) throw error
    return res.json({ success: true, sessionIds: (data || []).map(r => r.session_id) })
  } catch (err) { next(err) }
}

// ═══════════════════════════════════════════════════════════════
// POSTS
// ═══════════════════════════════════════════════════════════════

// GET /api/community/posts
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

// POST /api/community/posts
async function createPost(req, res, next) {
  try {
    const { group_id, content, display_name, is_anonymous } = req.body
    const userId = req.user?.sub || null

    if (!content?.trim())
      return res.status(400).json({ success: false, message: 'Post content is required.' })
    if (!group_id)
      return res.status(400).json({ success: false, message: 'group_id is required.' })

    // Verify group exists
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

// POST /api/community/posts/:id/like
async function likePost(req, res, next) {
  try {
    const postId    = req.params.id
    const userId    = req.user?.sub || null
    const sessionKey = req.body.session_key || null

    // Check if already liked
    let existing
    if (userId) {
      const { data } = await supabase.from('post_likes').select('id').eq('post_id', postId).eq('user_id', userId).maybeSingle()
      existing = data
    }

    if (existing) {
      // Unlike
      await supabase.from('post_likes').delete().eq('id', existing.id)
      return res.json({ success: true, liked: false })
    }

    // Like
    await supabase.from('post_likes').insert({ post_id: postId, user_id: userId, session_key: sessionKey })
    return res.json({ success: true, liked: true })
  } catch (err) { next(err) }
}

// DELETE /api/community/posts/:id  (own post or admin)
async function deletePost(req, res, next) {
  try {
    const userId = req.user?.sub
    const role   = req.user?.role

    const { data: post } = await supabase.from('community_posts').select('user_id').eq('id', req.params.id).single()
    if (!post) return res.status(404).json({ success: false, message: 'Post not found.' })

    if (post.user_id !== userId && !['admin', 'staff'].includes(role))
      return res.status(403).json({ success: false, message: 'Not authorized.' })

    await supabase.from('community_posts').update({ is_deleted: true }).eq('id', req.params.id)
    return res.json({ success: true })
  } catch (err) { next(err) }
}

// ═══════════════════════════════════════════════════════════════
// APPOINTMENT NOTES (Therapist)
// ═══════════════════════════════════════════════════════════════

// GET /api/therapist-portal/appointments/:id/notes
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

// PUT /api/therapist-portal/appointments/:id/notes
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
        group_memberships ( count )
      `)
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

async function adminCreateGroup(req, res, next) {
  try {
    const { name, description, emoji, tags } = req.body
    if (!name?.trim()) return res.status(400).json({ success: false, message: 'Name is required.' })

    const { data, error } = await supabase
      .from('community_groups')
      .insert({ name: name.trim(), description: description?.trim(), emoji: emoji || '💙', tags: tags || [], created_by: req.user?.sub })
      .select()
      .single()

    if (error) throw error
    return res.status(201).json({ success: true, group: data })
  } catch (err) { next(err) }
}

async function adminToggleGroup(req, res, next) {
  try {
    const { data: current } = await supabase.from('community_groups').select('is_active').eq('id', req.params.id).single()
    const { data, error } = await supabase.from('community_groups').update({ is_active: !current.is_active }).eq('id', req.params.id).select().single()
    if (error) throw error
    return res.json({ success: true, group: data })
  } catch (err) { next(err) }
}

async function adminListSessions(req, res, next) {
  try {
    const { data, error } = await supabase
      .from('group_sessions')
      .select(`
        id, title, facilitator, mode, scheduled_at, max_spots, is_active, created_at,
        community_groups ( name ),
        session_reservations ( count )
      `)
      .order('scheduled_at', { ascending: false })

    if (error) throw error
    const sessions = (data || []).map(s => ({
      ...s,
      reserved_count: s.session_reservations?.[0]?.count ?? 0,
      spots_left: s.max_spots - (s.session_reservations?.[0]?.count ?? 0),
      session_reservations: undefined,
    }))
    return res.json({ success: true, sessions })
  } catch (err) { next(err) }
}

async function adminCreateSession(req, res, next) {
  try {
    const { title, facilitator, mode, scheduled_at, max_spots, group_id, notes } = req.body
    if (!title || !facilitator || !scheduled_at)
      return res.status(400).json({ success: false, message: 'title, facilitator and scheduled_at are required.' })

    const { data, error } = await supabase
      .from('group_sessions')
      .insert({ title, facilitator, mode: mode || 'Online (Zoom)', scheduled_at, max_spots: max_spots || 20, group_id: group_id || null, notes: notes || null, created_by: req.user?.sub })
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
    const { data, error } = await supabase.from('community_posts').update({ is_approved }).eq('id', req.params.id).select().single()
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
    const { session_id } = req.query
    let query = supabase
      .from('session_reservations')
      .select(`
        id, display_name, email, is_anonymous, status, reserved_at,
        group_sessions ( title, scheduled_at ),
        profiles!session_reservations_user_id_fkey ( full_name, email )
      `)
      .order('reserved_at', { ascending: false })

    if (session_id) query = query.eq('session_id', session_id)
    const { data, error } = await query
    if (error) throw error
    return res.json({ success: true, reservations: data })
  } catch (err) { next(err) }
}

module.exports = {
  listGroups, getGroup, joinGroup, leaveGroup, checkMembership, myGroups,
  listSessions, reserveSession, cancelReservation, myReservations,
  listPosts, createPost, likePost, deletePost,
  getAppointmentNote, upsertAppointmentNote,
  adminListGroups, adminCreateGroup, adminToggleGroup,
  adminListSessions, adminCreateSession,
  adminListPosts, adminModeratePost, adminDeletePost,
  adminListReservations,
}