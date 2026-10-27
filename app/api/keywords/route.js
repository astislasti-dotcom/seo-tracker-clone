import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

export async function GET() {
  const { data, error } = await supabase
    .from('keywords')
    .select('*')
    .order('priority', { ascending: true })

  if (error) return Response.json({ error }, { status: 500 })
  return Response.json(data)
}

export async function POST(req) {
  const keywords = await req.json()
  const { data, error } = await supabase
    .from('keywords')
    .insert(keywords)

  if (error) return Response.json({ error }, { status: 500 })
  return Response.json(data)
}