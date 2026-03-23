/* eslint-disable no-undef */
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// GET /api/notifications
const getNotifications = async (req, res) => {
  const { unread, page = 1, limit = 20 } = req.query
  const offset = (page - 1) * limit

  let query = supabase
    .from('notifications')
    .select('*', { count: 'exact' })
    .eq('user_id', req.user.sub)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (unread === 'true') query = query.eq('is_read', false)

  const { data, error, count } = await query

  if (error) return res.status(500).json({ success: false, message: 'Could not fetch notifications.' })

  const unreadCount = data?.filter((n) => !n.is_read).length ?? 0

  return res.status(200).json({
    success: true,
    notifications: data,
    unreadCount,
    pagination: { page: Number(page), limit: Number(limit), total: count },
  })
}

// PATCH /api/notifications/:id/read
const markAsRead = async (req, res) => {
  const { error } = await supabase
    .from('notifications')
    .update({ is_read: true })
    .eq('id', req.params.id)
    .eq('user_id', req.user.sub)

  if (error) return res.status(500).json({ success: false, message: 'Could not mark as read.' })
  return res.status(200).json({ success: true, message: 'Notification marked as read.' })
}

// PATCH /api/notifications/read-all
const markAllAsRead = async (req, res) => {
  const { error } = await supabase
    .from('notifications')
    .update({ is_read: true })
    .eq('user_id', req.user.sub)
    .eq('is_read', false)

  if (error) return res.status(500).json({ success: false, message: 'Could not mark all as read.' })
  return res.status(200).json({ success: true, message: 'All notifications marked as read.' })
}

// DELETE /api/notifications/:id
const deleteNotification = async (req, res) => {
  const { error } = await supabase
    .from('notifications')
    .delete()
    .eq('id', req.params.id)
    .eq('user_id', req.user.sub)

  if (error) return res.status(500).json({ success: false, message: 'Could not delete notification.' })
  return res.status(200).json({ success: true, message: 'Notification deleted.' })
}

module.exports = { getNotifications, markAsRead, markAllAsRead, deleteNotification }