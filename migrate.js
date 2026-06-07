/**
 * Run once: node migrate.js
 * Adds permissions column to users table for counselors
 */
import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const DEFAULT_PERMISSIONS = {
  pref_list_manage: true,   // upload, edit, delete, publish pref lists
  documents_manage: true,   // verify/reject documents
  sessions_manage: true,    // create/edit sessions
  students_edit: true,      // edit student profile/scores
  stage_update: true,       // update counseling stage
  notes_manage: true        // create/delete notes
}

async function migrate() {
  console.log('\nMindzSpark Migration\n')

  // Test if permissions column exists by checking a counselor's data
  const { data: testUser } = await supabase
    .from('users').select('id, role, permissions').eq('role', 'counselor').limit(1).single()

  if (testUser && testUser.permissions === undefined) {
    console.log('⚠️  permissions column does not exist yet.')
    console.log('\nRun this SQL in your Supabase SQL Editor:\n')
    console.log(`ALTER TABLE users ADD COLUMN IF NOT EXISTS permissions JSONB DEFAULT '${JSON.stringify(DEFAULT_PERMISSIONS)}';`)
    console.log('\nThen re-run: node migrate.js\n')
    process.exit(1)
  }

  // Set default permissions for all counselors that have null/empty permissions
  const { data: counselors } = await supabase
    .from('users').select('id, name, permissions').eq('role', 'counselor')

  let updated = 0
  for (const c of counselors || []) {
    if (!c.permissions || Object.keys(c.permissions).length === 0) {
      await supabase.from('users').update({ permissions: DEFAULT_PERMISSIONS }).eq('id', c.id)
      console.log(`  ✓ Set default permissions for ${c.name}`)
      updated++
    } else {
      console.log(`  — ${c.name} already has permissions`)
    }
  }

  console.log(`\n✅ Done. ${updated} counselor(s) updated.\n`)
  process.exit(0)
}

migrate().catch(err => {
  console.error('Migration failed:', err.message)
  process.exit(1)
})
