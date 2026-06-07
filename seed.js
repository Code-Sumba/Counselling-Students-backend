/**
 * MindzSpark Portal Seed Script
 * Creates: 1 admin, 1 counselor (C001/Anjali), 3 students with full data
 * All passwords: Mindzspark@123
 * Run: node seed.js
 */
import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

const DEFAULT_DOCS = [
  { doc_type: 'ssc', label: 'SSC Marksheet (10th)' },
  { doc_type: 'hssc', label: 'HSSC Marksheet (12th)' },
  { doc_type: 'cet_hall', label: 'CET Hall Ticket' },
  { doc_type: 'cet_score', label: 'CET Score Card' },
  { doc_type: 'domicile', label: 'Domicile Certificate' },
  { doc_type: 'caste', label: 'Caste Certificate' },
  { doc_type: 'ncl', label: 'Non-Creamy Layer Certificate' },
  { doc_type: 'income', label: 'Income Certificate' },
  { doc_type: 'aadhar', label: 'Aadhar Card' },
  { doc_type: 'photo', label: 'Passport Size Photo' },
  { doc_type: 'leaving', label: 'School Leaving Certificate' },
]

const ADMIN_EMAIL    = 'mindzsparkmht@gmail.com'
const ADMIN_PASSWORD = 'MindzsparkAS@26'
const DEFAULT_PASSWORD = 'Mindzspark@123'

async function createUser(email, name, memberId, role, phone) {
  const password = role === 'admin' ? ADMIN_PASSWORD : DEFAULT_PASSWORD

  const { data: existing } = await supabase.auth.admin.listUsers()

  // Find auth user by email first; if not found, fall back to member_id in public.users
  let authUser = existing?.users?.find(u => u.email === email)

  if (!authUser) {
    const { data: profile } = await supabase
      .from('users').select('id').eq('member_id', memberId).maybeSingle()
    if (profile) {
      authUser = existing?.users?.find(u => u.id === profile.id)
      if (authUser) {
        // Email changed — update auth record
        await supabase.auth.admin.updateUserById(authUser.id, {
          email, password, email_confirm: true
        })
        console.log(`  ↻ Updated auth user: ${authUser.email} → ${email}`)
      }
    }
  }

  let authUserId
  if (authUser) {
    authUserId = authUser.id
    await supabase.auth.admin.updateUserById(authUserId, { password })
    console.log(`  ↻ Auth user exists, password updated: ${email}`)
  } else {
    const { data: created, error } = await supabase.auth.admin.createUser({
      email, password, email_confirm: true
    })
    if (error) throw new Error(`Auth createUser failed for ${email}: ${error.message}`)
    authUserId = created.user.id
  }

  // Upsert into users table
  const { error: userErr } = await supabase.from('users').upsert({
    id: authUserId,
    member_id: memberId,
    name,
    email,
    phone,
    role,
    is_active: true,
    password_set: true
  }, { onConflict: 'id' })

  if (userErr) throw new Error(`users upsert failed: ${userErr.message}`)
  return authUserId
}

async function seed() {
  console.log('\n🌱 MindzSpark Portal Seed Script\n')

  // ── ADMIN ──
  console.log('Creating Admin...')
  await createUser(ADMIN_EMAIL, 'Admin', 'ADMIN', 'admin', '')
  console.log(`  ✓ Admin: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`)

  // ── COUNSELOR ──
  console.log('\nCreating Counselor...')
  const counselorId = await createUser('anjali@mindzspark.in', 'Anjali Sharma', 'C001', 'counselor', '9100000001')
  console.log('  ✓ Counselor: C001 / Mindzspark@123')

  // ── STUDENTS ──
  const students = [
    {
      name: 'Rohan Patil', email: 'rohan.patil@student.mindzspark.in',
      memberId: 'MS2026001', phone: '9200000001',
      cet_score: 142, percentile: 97.5, hssc_marks: 88,
      category: 'Open', branch_preference: 'Computer Engineering',
      city: 'Pune', dob: '15 Aug 2006', stage: 2,
      parent_name: 'Suresh Patil', parent_phone: '9200000099'
    },
    {
      name: 'Priya Kulkarni', email: 'priya.kulkarni@student.mindzspark.in',
      memberId: 'MS2026002', phone: '9200000002',
      cet_score: 118, percentile: 91.2, hssc_marks: 78,
      category: 'OBC', branch_preference: 'Information Technology',
      city: 'Nashik', dob: '22 Mar 2006', stage: 1,
      parent_name: 'Ramesh Kulkarni', parent_phone: '9200000098'
    },
    {
      name: 'Aditya More', email: 'aditya.more@student.mindzspark.in',
      memberId: 'MS2026003', phone: '9200000003',
      cet_score: 98, percentile: 84.6, hssc_marks: 72,
      category: 'SC', branch_preference: 'Mechanical Engineering',
      city: 'Aurangabad', dob: '5 Dec 2005', stage: 3,
      parent_name: 'Vijay More', parent_phone: '9200000097'
    }
  ]

  for (const s of students) {
    console.log(`\nCreating Student: ${s.name}...`)
    const userId = await createUser(s.email, s.name, s.memberId, 'student', s.phone)

    // Upsert student record
    const { data: student, error: sErr } = await supabase
      .from('students')
      .upsert({
        user_id: userId,
        member_id: s.memberId,
        cet_score: s.cet_score,
        percentile: s.percentile,
        hssc_marks: s.hssc_marks,
        category: s.category,
        branch_preference: s.branch_preference,
        city: s.city,
        dob: s.dob,
        stage: s.stage,
        status: 'Active',
        payment_status: 'Paid',
        payment_amount: 5000,
        counselor_id: counselorId,
        parent_name: s.parent_name,
        parent_phone: s.parent_phone,
        domicile: 'Maharashtra',
        annual_income: 'Below 1 Lakh'
      }, { onConflict: 'member_id' })
      .select()
      .single()

    if (sErr) throw new Error(`Student upsert failed: ${sErr.message}`)

    // Check existing docs
    const { count: docCount } = await supabase
      .from('documents')
      .select('*', { count: 'exact', head: true })
      .eq('student_id', student.id)

    if (!docCount) {
      await supabase.from('documents').insert(
        DEFAULT_DOCS.map(d => ({ ...d, student_id: student.id, status: 'Pending' }))
      )
    }

    console.log(`  ✓ Student: ${s.memberId} / Mindzspark@123`)
  }

  // ── SAMPLE PREF LIST for MS2026001 ──
  console.log('\nCreating sample pref list for MS2026001...')
  const { data: ms1 } = await supabase
    .from('students').select('id').eq('member_id', 'MS2026001').single()

  if (ms1) {
    const sampleEntries = [
      { id: 'e1', rank: 1, college_name: 'COEP Technological University', branch: 'Computer Engineering', type: 'Government', city: 'Pune', cutoff: 99.1, zone: 'Pune', confidence: 'high' },
      { id: 'e2', rank: 2, college_name: 'VJTI Mumbai', branch: 'Computer Engineering', type: 'Government', city: 'Mumbai', cutoff: 98.8, zone: 'Mumbai', confidence: 'high' },
      { id: 'e3', rank: 3, college_name: 'PICT Pune', branch: 'Computer Engineering', type: 'Unaided', city: 'Pune', cutoff: 97.2, zone: 'Pune', confidence: 'high' },
      { id: 'e4', rank: 4, college_name: 'VIT Pune', branch: 'Computer Engineering', type: 'Unaided', city: 'Pune', cutoff: 96.5, zone: 'Pune', confidence: 'high' },
      { id: 'e5', rank: 5, college_name: 'MIT College of Engineering', branch: 'Computer Engineering', type: 'Unaided', city: 'Pune', cutoff: 95.8, zone: 'Pune', confidence: 'high' },
    ]

    const { count: listCount } = await supabase
      .from('pref_lists').select('*', { count: 'exact', head: true }).eq('student_id', ms1.id)

    if (!listCount) {
      await supabase.from('pref_lists').insert({
        student_id: ms1.id,
        version: 1,
        entries: sampleEntries,
        source_type: 'manual',
        uploaded_by: 'C001',
        is_published: true,
        published_at: new Date().toISOString(),
        notes: 'Focus on Computer Engineering in Pune region. Top government colleges first.'
      })
      console.log('  ✓ Pref list created and published for MS2026001')
    }
  }

  console.log('\n✅ Seed complete!\n')
  console.log('Default logins:')
  console.log(`  Admin:     ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`)
  console.log('  Counselor: C001      / Mindzspark@123')
  console.log('  Student 1: MS2026001 / Mindzspark@123')
  console.log('  Student 2: MS2026002 / Mindzspark@123')
  console.log('  Student 3: MS2026003 / Mindzspark@123\n')

  process.exit(0)
}

seed().catch(err => {
  console.error('\n❌ Seed failed:', err.message)
  process.exit(1)
})
