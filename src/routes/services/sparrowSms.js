const SPARROW_URL = 'https://api.sparrowsms.com/v2/sms/'
const TOKEN = process.env.SPARROW_TOKEN
const FROM  = process.env.SPARROW_FROM

async function sendSms(toNumbers, text) {
  const CHUNK = 200
  const results = []
  for (let i = 0; i < toNumbers.length; i += CHUNK) {
    const batch = toNumbers.slice(i, i + CHUNK).join(',')
    const params = new URLSearchParams({ token: TOKEN, from: FROM, to: batch, text })
    const res = await fetch(`${SPARROW_URL}?${params}`)
    const data = await res.json().catch(() => ({}))
    results.push({ count: batch.split(',').length, ...data })
  }
  return results
}

module.exports = { sendSms }