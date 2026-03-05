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

    const hostname = new URL(url).hostname.replace('www.', '')
    const pathname = new URL(url).pathname

    // Step 1: Open Graph metadata
    let ogData: any = {}
    try {
      const pageRes = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; IngestIO/1.0)' },
        signal: AbortSignal.timeout(8000),
        redirect: 'follow',
      })
      const html = await pageRes.text()
      const ogTitle = html.match(/<meta[^>]*property="og:title"[^>]*content="([^"]*)"/) ||
                      html.match(/<meta[^>]*content="([^"]*)"[^>]*property="og:title"/)
      const ogDesc = html.match(/<meta[^>]*property="og:description"[^>]*content="([^"]*)"/) ||
                     html.match(/<meta[^>]*content="([^"]*)"[^>]*property="og:description"/)
      const title = html.match(/<title[^>]*>([^<]*)<\/title>/)
      ogData = { title: ogTitle?.[1] || title?.[1] || '', description: ogDesc?.[1] || '' }
    } catch {}

    // Step 2: Platform-specific extraction
    let platformData: any = null
    let platformType = 'generic'

    try {
      // ── Twitter/X ──
      if (hostname.includes('x.com') || hostname.includes('twitter.com')) {
        platformType = 'twitter'
        
        // oEmbed - gets tweet text for public tweets
        try {
          const oRes = await fetch(
            `https://publish.twitter.com/oembed?url=${encodeURIComponent(url)}&omit_script=true`,
            { signal: AbortSignal.timeout(5000) }
          )
          if (oRes.ok) {
            const data = await oRes.json()
            let tweetText = ''
            if (data.html) {
              const m = data.html.match(/<blockquote[^>]*><p[^>]*>([\s\S]*?)<\/p>/)
              if (m) {
                tweetText = m[1]
                  .replace(/<a[^>]*>(.*?)<\/a>/g, '$1')
                  .replace(/<br\s*\/?>/g, '\n')
                  .replace(/<[^>]+>/g, '')
                  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
                  .trim()
              }
            }
            platformData = { author: data.author_name || '', tweetText, type: 'tweet' }
          }
        } catch {}

        // Syndication API - gets metrics + media info
        const statusMatch = url.match(/status\/(\d+)/)
        if (statusMatch) {
          try {
            const synRes = await fetch(
              `https://cdn.syndication.twimg.com/tweet-result?id=${statusMatch[1]}&token=0`,
              { signal: AbortSignal.timeout(5000) }
            )
            if (synRes.ok) {
              const s = await synRes.json()
              if (s.text) {
                platformData = platformData || {}
                platformData.tweetText = s.text
                platformData.author = s.user?.name || platformData?.author || ''
                platformData.metrics = { likes: s.favorite_count, retweets: s.retweet_count, replies: s.reply_count }
                if (s.mediaDetails?.length) {
                  platformData.hasMedia = true
                  platformData.mediaType = s.mediaDetails[0].type
                }
              }
            }
          } catch {}
        }
      }

      // ── Spotify ──
      else if (hostname.includes('spotify.com')) {
        platformType = 'spotify'
        const oRes = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`)
        if (oRes.ok) {
          platformData = await oRes.json()
          if (pathname.includes('/track/')) platformData.spotifyType = 'track'
          else if (pathname.includes('/album/')) platformData.spotifyType = 'album'
          else if (pathname.includes('/playlist/')) platformData.spotifyType = 'playlist'
          else if (pathname.includes('/artist/')) platformData.spotifyType = 'artist'
        }
      }

      // ── YouTube ──
      else if (hostname.includes('youtube.com') || hostname.includes('youtu.be')) {
        platformType = 'youtube'
        const oRes = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`)
        if (oRes.ok) platformData = await oRes.json()
      }

      // ── GitHub ──
      else if (hostname === 'github.com') {
        platformType = 'github'
        const repoMatch = pathname.match(/^\/([^/]+)\/([^/]+)\/?$/)
        if (repoMatch) {
          const apiRes = await fetch(
            `https://api.github.com/repos/${repoMatch[1]}/${repoMatch[2]}`,
            { headers: { 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'IngestIO' }, signal: AbortSignal.timeout(5000) }
          )
          if (apiRes.ok) {
            const r = await apiRes.json()
            platformData = {
              name: r.full_name, description: r.description, stars: r.stargazers_count,
              forks: r.forks_count, language: r.language, topics: r.topics,
              lastPush: r.pushed_at, openIssues: r.open_issues_count, license: r.license?.spdx_id,
            }
          }
        }
      }
    } catch {}

    // Step 3: Build context
    let ctx = [`URL: ${url}`, `Platform: ${platformType}`]
    if (ogData.title) ctx.push(`Page title: ${ogData.title}`)
    if (ogData.description) ctx.push(`OG description: ${ogData.description}`)
    
    if (platformData) {
      if (platformType === 'twitter') {
        if (platformData.tweetText) ctx.push(`TWEET TEXT: "${platformData.tweetText}"`)
        if (platformData.author) ctx.push(`Author: ${platformData.author}`)
        if (platformData.metrics) ctx.push(`Engagement: ${JSON.stringify(platformData.metrics)}`)
        if (platformData.hasMedia) ctx.push(`Has media: ${platformData.mediaType}`)
      } else if (platformType === 'github') {
        ctx.push(`GitHub: ${JSON.stringify(platformData)}`)
      } else {
        ctx.push(`Platform data: ${JSON.stringify(platformData)}`)
      }
    }
    if (intent) ctx.push(`User context: ${intent}`)

    // Step 4: Platform-aware prompt
    let extra = ''
    if (platformType === 'twitter' && !platformData?.tweetText) {
      extra = ' The tweet text could not be extracted. Search the web for this specific tweet URL to find what it says. Focus on the POST CONTENT, not the account.'
    } else if (platformType === 'twitter' && platformData?.tweetText) {
      extra = ' The actual tweet text has been provided. Analyze THIS SPECIFIC POST, not the account. Focus on what the tweet says, its topic, any claims or recommendations.'
    }

    const sys = `You analyze URLs for INGEST.IO. Use web_search to find additional details.${extra} Return ONLY valid JSON: {"title":"str","sub":"str","type":"TOOL|ARTICLE|VIDEO|SOCIAL|GITHUB|OTHER","summary":"str","details":["str"],"pros":["str"],"cons":["str"],"bestFor":["str"],"tags":["str"],"category":"str","score":50,"longevity":"3-6mo|6-12mo|12mo+"}`

    // Step 5: Claude
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        system: sys,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        messages: [{ role: 'user', content: `Analyze this URL:\n${ctx.join('\n')}\n\nSearch the web for more details and return JSON.` }],
      }),
    })

    const claudeData = await claudeRes.json()
    let allText = ''
    for (const block of (claudeData.content || [])) {
      if (block.type === 'text' && block.text) allText += block.text
    }

    // Parse JSON
    let parsed: any = null
    try {
      const jm = allText.match(/\{[\s\S]*\}/)
      if (jm) parsed = JSON.parse(jm[0])
    } catch {
      try {
        parsed = JSON.parse(allText.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim())
      } catch {
        parsed = {
          title: platformData?.title || platformData?.author || ogData.title || hostname,
          sub: ogData.description?.substring(0, 80) || 'Analyzed',
          type: 'OTHER',
          summary: platformData?.tweetText || ogData.description || allText.substring(0, 300) || 'Saved for reference.',
          details: ['Auto-analysis returned non-structured data'],
          pros: ['Link saved'], cons: ['May need manual review'],
          bestFor: ['Reference'], tags: ['new'], category: 'Other', score: 50, longevity: '6-12mo',
        }
      }
    }

    // Enrich
    if (platformData && parsed) {
      if (platformType === 'twitter' && platformData.author && !parsed.tags?.includes(platformData.author)) {
        parsed.tags = [...(parsed.tags || []), platformData.author]
      }
      if (platformType === 'github' && platformData.stars) {
        parsed.details = [...(parsed.details || []), `${platformData.stars.toLocaleString()} stars`, platformData.language || 'Unknown']
      }
      if (platformData?.title && (!parsed.title || parsed.title === hostname)) parsed.title = platformData.title
      if (platformData?.author_name && !parsed.tags?.includes(platformData.author_name)) {
        parsed.tags = [...(parsed.tags || []), platformData.author_name]
      }
    }

    // Clean
    if (parsed.summary) parsed.summary = parsed.summary.replace(/<cite[^>]*>/g, '').replace(/<\/cite>/g, '')
    if (parsed.details) parsed.details = parsed.details.map((d: string) => d.replace(/<cite[^>]*>/g, '').replace(/<\/cite>/g, ''))

    return NextResponse.json({ success: true, data: parsed })
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Ingestion failed' }, { status: 500 })
  }
}
