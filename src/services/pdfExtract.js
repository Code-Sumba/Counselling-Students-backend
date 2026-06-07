import pdfParse from 'pdf-parse/lib/pdf-parse.js'

const MAHARASHTRA_CITIES = ['Pune', 'Mumbai', 'Nashik', 'Nagpur', 'Aurangabad',
  'Kolhapur', 'Thane', 'Nanded', 'Solapur', 'Amravati', 'Latur', 'Satara',
  'Sangli', 'Jalgaon', 'Ahmednagar', 'Ratnagiri', 'Dhule', 'Akola', 'Wardha']

const INSTITUTE_TYPES = {
  govt: ['Government', 'Govt', 'GVT', 'COEP', 'VJTI', 'PCCOE'],
  aided: ['Aided', 'Government Aided', 'Govt Aided'],
}

const BRANCHES = ['Computer Engineering', 'Information Technology',
  'Mechanical Engineering', 'Electronics Engineering', 'Civil Engineering',
  'Electrical Engineering', 'Artificial Intelligence', 'Data Science',
  'Electronics and Telecommunication', 'Chemical Engineering',
  'Computer Science', 'AI & DS', 'ENTC', 'IT']

export async function extractFromPDF(buffer) {
  const data = await pdfParse(buffer)
  const lines = data.text.split('\n').map(l => l.trim()).filter(Boolean)

  const entries = []
  let autoRank = 1

  for (const line of lines) {
    const numbered = line.match(/^(\d+)[.)]\s*(.+)/)
    if (numbered) {
      const entry = parseCollegeEntry(numbered[2], parseInt(numbered[1]))
      if (entry) { entries.push(entry); autoRank = entry.rank + 1 }
    } else if (looksLikeCollege(line)) {
      const entry = parseCollegeEntry(line, autoRank++)
      if (entry) entries.push(entry)
    }
  }

  return {
    entries,
    rawText: data.text,
    totalPages: data.numpages,
    confidence: calculateOverallConfidence(entries)
  }
}

function parseCollegeEntry(text, rank) {
  if (!text || text.length < 5) return null

  const city = MAHARASHTRA_CITIES.find(c => text.includes(c)) || null
  const branch = BRANCHES.find(b => text.toLowerCase().includes(b.toLowerCase())) || null

  let type = 'Unaided'
  if (INSTITUTE_TYPES.govt.some(k => text.includes(k))) type = 'Government'
  else if (INSTITUTE_TYPES.aided.some(k => text.includes(k))) type = 'Government Aided'

  const cutoffMatch = text.match(/(\d{2,3}\.\d{1,4})/)
  const cutoff = cutoffMatch ? parseFloat(cutoffMatch[1]) : null

  let collegeName = text
    .replace(branch || '', '')
    .replace(city || '', '')
    .replace(cutoffMatch?.[0] || '', '')
    .replace(/[-|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (!collegeName || collegeName.length < 3) return null

  const confidence = calculateEntryConfidence({ collegeName, branch, city, type, cutoff })

  return {
    id: `entry_${rank}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    rank,
    college_name: collegeName,
    branch: branch || '',
    type,
    city: city || '',
    cutoff: cutoff || null,
    zone: city ? detectZone(city) : '',
    confidence
  }
}

function calculateEntryConfidence(entry) {
  let score = 0
  if (entry.collegeName && entry.collegeName.length > 5) score++
  if (entry.branch) score++
  if (entry.city) score++
  if (entry.cutoff) score++
  if (score >= 3) return 'high'
  if (score === 2) return 'medium'
  return 'low'
}

function calculateOverallConfidence(entries) {
  if (!entries.length) return 'low'
  const highCount = entries.filter(e => e.confidence === 'high').length
  const ratio = highCount / entries.length
  if (ratio >= 0.7) return 'high'
  if (ratio >= 0.4) return 'medium'
  return 'low'
}

function detectZone(city) {
  const zones = {
    'Pune': 'Pune', 'Nashik': 'Nashik', 'Mumbai': 'Mumbai',
    'Thane': 'Mumbai', 'Nagpur': 'Nagpur', 'Aurangabad': 'Aurangabad',
    'Kolhapur': 'Kolhapur', 'Solapur': 'Solapur', 'Amravati': 'Amravati'
  }
  return zones[city] || 'Other'
}

function looksLikeCollege(line) {
  const keywords = ['College', 'Institute', 'Engineering', 'Technology', 'University',
    'COEP', 'PICT', 'VIT', 'MIT', 'VJTI', 'PCCE']
  return keywords.some(k => line.includes(k)) && line.length > 10
}
