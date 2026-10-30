import { redirect } from 'next/navigation'

// E1: the dashboard is the single entry point. The former home page used a
// duplicated catalog view and is no longer served.
export default function Home() {
  redirect('/dashboard')
}
