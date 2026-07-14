const { createClient } = require('@supabase/supabase-js')
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

// ---------- PUT /api/admin/orders/:id/assign-rider ----------
exports.assignRider = async (req, res) => {
  try {
    const { id } = req.params
    const { rider_id } = req.body

    if (rider_id) {
      const { data: rider, error: riderErr } = await supabase
        .from('delivery_riders').select('id, is_active').eq('id', rider_id).single()
      if (riderErr || !rider) return res.status(404).json({ message: 'Rider not found' })
      if (!rider.is_active) return res.status(400).json({ message: 'This rider is deactivated' })
    }

    const { data: order, error } = await supabase
      .from('orders')
      .update({ delivery_rider_id: rider_id || null })
      .eq('id', id)
      .select('*, delivery_riders(id, full_name, area, vehicle_type)')
      .single()
    if (error) throw error

    res.json({ order })
  } catch (e) {
    res.status(500).json({ message: e.message })
  }
}