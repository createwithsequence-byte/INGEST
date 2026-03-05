'use client'

import dynamic from 'next/dynamic'

const IngestApp = dynamic(() => import('@/components/IngestApp'), { ssr: false })

export default function Home() {
  return <IngestApp />
}
