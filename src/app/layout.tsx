import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'ingest.io — AI-Powered Link Intelligence',
  description: 'Transform URLs into structured knowledge. Paste any link, get instant AI analysis with relevance tracking.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
