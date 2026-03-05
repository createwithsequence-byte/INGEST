import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  try {
    const { message, cardContext, history } = await req.json()

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: 'API key not configured' }, { status: 500 })
    }

    const messages = [
      ...(history || []).map((m: any) => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: m.text,
      })),
      { role: 'user', content: message },
    ]

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        system: `You are an AI in INGEST.IO. Use web search if helpful. Be concise (<150 words). Card context:\n${cardContext}`,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        messages,
      }),
    })

    const data = await res.json()
    let text = ''
    for (const block of (data.content || [])) {
      if (block.type === 'text' && block.text) text += block.text
    }

    // Strip cite tags
    text = text.replace(/<cite[^>]*>/g, '').replace(/<\/cite>/g, '')

    return NextResponse.json({ text: text || 'No response.' })

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
