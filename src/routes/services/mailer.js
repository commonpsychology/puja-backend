const nodemailer = require('nodemailer')

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: false, // true for port 465, false for 587
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
})

async function sendNotificationEmail({ to, title, message }) {
  if (!to) return
  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to,
    subject: title || 'Notification from Common Psychology',
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:auto;padding:24px;">
        <h2 style="color:#1a3a4a;margin-bottom:8px;">${title || 'Notification'}</h2>
        <p style="color:#334155;font-size:15px;line-height:1.6;">${message || ''}</p>
        <hr style="margin:24px 0;border:none;border-top:1px solid #e2e8f0;" />
        <p style="color:#94a3b8;font-size:12px;">Common Psychology · This is an automated message.</p>
      </div>
    `,
  })
}

module.exports = { sendNotificationEmail }