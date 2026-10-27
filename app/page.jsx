async function fetchKeywords() {
  try {
    const res = await fetch('/keywords.json')
    const data = await res.json()
    setKeywords(data || [])
  } catch (error) {
    console.error('Error:', error)
  } finally {
    setLoading(false)
  }
}
