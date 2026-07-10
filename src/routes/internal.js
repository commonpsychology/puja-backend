const express = require('express')
const { expireStaleHolds } = require('./controllers/appointmentController')

const router = express.Router()

router.get('/expire-holds', async (req, res) => {
  const isVercelCron = req.headers['user-agent']?.includes('vercel-cron')
  if (!isVercelCron) {
    return res.status(401).json({ success: false, message: 'Unauthorized.' })
  }

  try {
    const expired = await expireStaleHolds()
    return res.json({ success: true, expiredCount: expired.length, expiredIds: expired.map(e => e.id) })
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message })
  }
})

module.exports = router