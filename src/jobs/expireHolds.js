// src/jobs/expireHolds.js
// Runs expireStaleHolds() on a fixed schedule so abandoned/unpaid appointment
// holds get released even if nobody happens to hit book/getBookedSlots.
const cron = require('node-cron')
const { expireStaleHolds } = require('../routes/controllers/appointmentController')

// Every 5 minutes. Adjust the schedule if you want it tighter/looser —
// this just needs to run more often than HOLD_MINUTES (currently 30) to
// keep the delay bounded.
const SCHEDULE = '*/5 * * * *'

function startExpireHoldsJob() {
  cron.schedule(SCHEDULE, async () => {
    try {
      const expired = await expireStaleHolds()
      if (expired.length > 0) {
        console.log(`[expireHolds] Released ${expired.length} stale unpaid appointment(s): ${expired.map(e => e.id).join(', ')}`)
      }
    } catch (err) {
      console.error('[expireHolds] Job failed:', err.message)
    }
  })

  console.log(`[expireHolds] Scheduled job started (${SCHEDULE})`)
}

module.exports = { startExpireHoldsJob }