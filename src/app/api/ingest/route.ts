import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  try {
    const { url, intent } = await req.json()
    
    if (!url) {
      return NextResponse.json({ error: 'URL required' }, { status: 400 })
    }

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: 'API key not configured' }, { status: 500 })
    }

    // Step 1: Try to fetch Open Graph metadata
    let ogData: any = {}
    try {
      const pageRes = await fetch(url, {
        headers: { 'User-Agent': 'IngestIO/1.0' },
        signal: AbortSignal.timeout(8000),
      })
      const html = await pageRes.text()
      
      // Extract OG tags
      const ogTitle = html.match(/<meta[^>]*property="og:title"[^>]*content="([^"]*)"/) ||
                      html.match(/<meta[^>]*content="([^"]*)"[^>]*property="og:title"/)
      const ogDesc = html.match(/<meta[^>]*property="og:description"[^>]*content="([^"]*)"/) ||
                     html.match(/<meta[^>]*content="([^"]*)"[^>]*property="og:description"/)
      const title = html.match(/<title[^>]*>([^<]*)<\/title>/)
      
      ogData = {
        title: ogTitle?.[1] || title?.[1] || '',
        description: ogDesc?.[1] || '',
      }
    } catch {
      // Page fetch failed - continue with web search only
    }

    // Step 2: Try oEmbed for supported platforms
    let oembedData: any = null
    try {
      const hostname = new URL(url).hostname
      if (hostname.includes('spotify.com')) {
        const oembedRes = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`)
        if (oembedRes.ok) oembedData = await oembedRes.json()
      } else if (hostname.includes('youtube.com') || hostname.includes('youtu.be')) {
        const oembedRes = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`)
        if (oembedRes.ok) oembedData = await oembedRes.json()
      }
    } catch {
      // oEmbed failed - continue
    }

    // Step 3: Build context for Claude
    let contextParts = [`URL: ${url}`]
    if (ogData.title) contextParts.push(`Page title: ${ogData.title}`)
    if (ogData.description) contextParts.push(`Description: ${ogData.description}`)
    if (oembedData) contextParts.push(`oEmbed data: ${JSON.stringify(oembedData)}`)
    if (intent) contextParts.push(`User context: ${intent}`)

    const systemPrompt = `You analyze URLs for INGEST.IO. Use web_search to find additional details about this URL. Return ONLY valid JSON: {"title":"str","sub":"str","type":"TOOL|ARTICLE|VIDEO|SOCIAL|GITHUB|OTHER","summary":"str","details":["str"],"pros":["str"],"cons":["str"],"bestFor":["str"],"tags":["str"],"category":"str","score":50,"longevity":"3-6mo|6-12mo|12mo+"}`

    // Step 4: Call Claude with web search
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        system: systemPrompt,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        messages: [{ role: 'user', content: `Analyze this URL. Here is pre-fetched context:\n${contextParts.join('\n')}\n\nSearch the web for more details and return JSON.` }],
      }),
    })

    const claudeData = await claudeRes.json()

    // Extract text from response
    let allText = ''
    for (const block of (claudeData.content || [])) {
      if (block.type === 'text' && block.text) allText += block.text
    }

    // Parse JSON from response
    let parsed: any = null
    try {
      const jsonMatch = allText.match(/\{[\s\S]*\}/)
      if (jsonMatch) parsed = JSON.parse(jsonMatch[0])
    } catch {
      try {
        const clean = allText.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
        parsed = JSON.parse(clean)
      } catch {
        // Use OG data as fallback
        const host = new URL(url).hostname.replace('www.', '')
        parsed = {
          title: oembedData?.title || ogData.title || host,
          sub: ogData.description?.substring(0, 80) || 'Analyzed',
          type: 'OTHER',
          summary: ogData.description || allText.substring(0, 300) || 'Saved for reference.',
          details: ['Auto-analysis returned non-structured data'],
          pros: ['Link saved'],
          cons: ['May need manual review'],
          bestFor: ['Reference'],
          tags: ['new'],
          category: 'Other',
          score: 50,
          longevity: '6-12mo',
        }
      }
    }

    // Enrich with oEmbed data if available
    if (oembedData && parsed) {
      if (!parsed.title || parsed.title === new URL(url).hostname) {
        parsed.title = oembedData.title || parsed.title
      }
      if (oembedData.author_name && !parsed.tags?.includes(oembedData.author_name)) {
        parsed.tags = [...(parsed.tags || []), oembedData.author_name]
      }
    }

    // Strip cite tags
    if (parsed.summary) parsed.summary = parsed.summary.replace(/<cite[^>]*>/g, '').replace(/<\/cite>/g, '')
    if (parsed.details) parsed.details = parsed.details.map((d: string) => d.replace(/<cite[^>]*>/g, '').replace(/<\/cite>/g, ''))

    return NextResponse.json({ success: true, data: parsed })

  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Ingestion failed' }, { status: 500 })
  }
}
