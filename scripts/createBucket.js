// scripts/createBucket.js
require('dotenv').config() 
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY  // must be service role, not anon key
)

async function setup() {
  const { data, error } = await supabase.storage.createBucket('gallery-submissions', {
    public: false,
    fileSizeLimit: 10 * 1024 * 1024,      // 10 MB
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
  })

  if (error) console.error('Error:', error.message)
  else console.log('Bucket created:', data)
}

setup()