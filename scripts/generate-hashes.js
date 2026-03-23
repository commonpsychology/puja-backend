/* eslint-disable no-undef */
// scripts/generate-hashes.js
// Run: node scripts/generate-hashes.js
// This generates real bcrypt hashes and prints UPDATE statements

const bcrypt = require('bcryptjs')
const { createClient } = require('@supabase/supabase-js')
require('dotenv').config()

const STAFF = [
  { email: 'admin@pujasamargi.com.np',   password: 'Admin@123'  },
  { email: 'anita@pujasamargi.com.np',   password: 'Anita@123'  },
  { email: 'sunita@pujasamargi.com.np',  password: 'Sunita@123' },
  { email: 'rohan@pujasamargi.com.np',   password: 'Rohan@123'  },
  { email: 'prabha@pujasamargi.com.np',  password: 'Prabha@123' },
  { email: 'priya.sharma@gmail.com',     password: 'Client@123' },
  { email: 'ramesh.a@gmail.com',         password: 'Client@123' },
  { email: 'sita.g@yahoo.com',           password: 'Client@123' },
  { email: 'bikash.t@gmail.com',         password: 'Client@123' },
  { email: 'mina.k@gmail.com',           password: 'Client@123' },
  { email: 'dev.m@gmail.com',            password: 'Client@123' },
]

async function run() {
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  console.log('Generating bcrypt hashes and updating profiles…\n')

  for (const { email, password } of STAFF) {
    const hash = await bcrypt.hash(password, 12)
    const { error } = await supabase
      .from('profiles')
      .update({ password_hash: hash })
      .eq('email', email)

    if (error) {
      console.error(`  ✗ ${email}: ${error.message}`)
    } else {
      console.log(`  ✓ ${email} → password: ${password}`)
    }
  }

  console.log('\nDone! All passwords have been hashed and saved.')
  console.log('\nLogin credentials:')
  console.log('─'.repeat(50))
  STAFF.forEach(({ email, password }) => {
    console.log(`  ${email.padEnd(35)} → ${password}`)
  })
}

run().catch(console.error)