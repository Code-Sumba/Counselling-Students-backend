export async function generateStudentId(supabase) {
  const { data } = await supabase
    .from('students')
    .select('member_id')
    .like('member_id', 'MS2026%')
    .order('member_id', { ascending: false })
    .limit(1)

  let next = 204
  if (data?.[0]?.member_id) {
    const num = parseInt(data[0].member_id.replace('MS2026', ''), 10)
    if (!isNaN(num) && num >= 204) next = num + 1
  }

  return `MS2026${next}`
}

export async function generateCounselorId(supabase) {
  const { count } = await supabase
    .from('users')
    .select('*', { count: 'exact', head: true })
    .eq('role', 'counselor')

  const next = (count || 0) + 1
  return `C${String(next).padStart(3, '0')}`
}
