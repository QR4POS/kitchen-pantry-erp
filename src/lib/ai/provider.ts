interface AIProviderConfig {
  name: string
  model: string
  apiKey: string
}

interface AIResponse {
  content: string
  model: string
  provider: string
  error?: string
}

type AIMessage = { role: 'system' | 'user' | 'assistant'; content: string }

function getPrimaryConfig(): AIProviderConfig {
  return {
    name: 'openai',
    model: process.env.AI_MODEL ?? 'gpt-4',
    apiKey: process.env.OPENAI_API_KEY ?? '',
  }
}

function getFallbackConfig(): AIProviderConfig {
  return {
    name: 'gemini',
    model: 'gemini-pro',
    apiKey: process.env.GEMINI_API_KEY ?? '',
  }
}

async function callOpenAI(messages: AIMessage[], config: AIProviderConfig): Promise<AIResponse> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      temperature: 0.7,
      max_tokens: 2000,
    }),
  })

  if (!response.ok) {
    throw new Error(`OpenAI API error: ${response.status}`)
  }

  const data = await response.json()
  return {
    content: data.choices?.[0]?.message?.content ?? '',
    model: config.model,
    provider: 'openai',
  }
}

async function callGemini(messages: AIMessage[], config: AIProviderConfig): Promise<AIResponse> {
  const systemMessage = messages.find(m => m.role === 'system')?.content ?? ''
  const userMessages = messages.filter(m => m.role !== 'system').map(m => m.content).join('\n')
  const prompt = systemMessage ? `${systemMessage}\n\n${userMessages}` : userMessages

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${config.model}:generateContent?key=${config.apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 2000 },
    }),
  })

  if (!response.ok) {
    throw new Error(`Gemini API error: ${response.status}`)
  }

  const data = await response.json()
  return {
    content: data.candidates?.[0]?.content?.parts?.[0]?.text ?? '',
    model: config.model,
    provider: 'gemini',
  }
}

export async function callAI(messages: AIMessage[]): Promise<AIResponse> {
  const errors: string[] = []

  // Try primary provider
  const primary = getPrimaryConfig()
  if (primary.apiKey) {
    try {
      return await callOpenAI(messages, primary)
    } catch (e) {
      errors.push(`OpenAI: ${(e as Error).message}`)
    }
  }

  // Try fallback provider
  const fallback = getFallbackConfig()
  if (fallback.apiKey) {
    try {
      return await callGemini(messages, fallback)
    } catch (e) {
      errors.push(`Gemini: ${(e as Error).message}`)
    }
  }

  // No providers available - return rule-based response
  return getRuleBasedResponse(messages)
}

function getRuleBasedResponse(messages: AIMessage[]): AIResponse {
  const lastUserMessage = messages.filter(m => m.role === 'user').pop()?.content.toLowerCase() ?? ''

  if (lastUserMessage.includes('estimate') || lastUserMessage.includes('cost') || lastUserMessage.includes('price')) {
    return {
      content: `Based on standard kitchen pricing in the current market:

**Estimated Cost Range:**
- Economy Kitchen: Rs.1,50,000 - Rs.3,00,000
- Standard Kitchen: Rs.3,00,000 - Rs.5,50,000
- Premium Kitchen: Rs.5,50,000 - Rs.10,00,000
- Luxury Kitchen: Rs.10,00,000+

**Material Cost Breakdown (approximate):**
- MDF: Rs.450-550/sq.ft
- Plywood: Rs.550-700/sq.ft
- Acrylic: Rs.750-900/sq.ft
- Hardware: Rs.15,000-40,000
- Accessories: Rs.25,000-80,000

*Please create a detailed estimate in the system for accurate pricing.*`,
      model: 'rule-based',
      provider: 'offline',
    }
  }

  if (lastUserMessage.includes('design') || lastUserMessage.includes('layout') || lastUserMessage.includes('style')) {
    return {
      content: `**Kitchen Design Recommendations:**

For your kitchen, I recommend:

1. **Layout**: L-Shape is ideal for most kitchens, providing good workflow and storage
2. **Cabinets**: Mix of base (60%) and wall cabinets (40%)
3. **Material**: Plywood for durability, Acrylic for premium finish
4. **Color Scheme**: Light colors for small kitchens, dark accents for large spaces
5. **Lighting**: Under-cabinet LED strips + pendant lights over island
6. **Storage**: Pull-out baskets, corner carousel, tall unit for pantry

Would you like me to elaborate on any specific aspect?`,
      model: 'rule-based',
      provider: 'offline',
    }
  }

  if (lastUserMessage.includes('material') || lastUserMessage.includes('recommend')) {
    return {
      content: `**Material Recommendations by Budget:**

**Budget-Friendly (Rs.1.5L - 3L):**
- Melamine boards
- Standard hinges
- Basic hardware
- PVC edge banding

**Mid-Range (Rs.3L - 5.5L):**
- Plywood with laminate finish
- Soft-close hinges
- Standard accessories
- Quartz countertop

**Premium (Rs.5.5L - 10L):**
- Acrylic or HPL finish
- Hydraulic soft-close systems
- Tandem drawer boxes
- Granite/quartz countertop
- LED lighting package

**Luxury (Rs.10L+):**
- Solid wood or premium acrylic
- Full soft-close everywhere
- Corner units, pull-outs, organizers
- Smart storage solutions
- Premium appliances`,
      model: 'rule-based',
      provider: 'offline',
    }
  }

  return {
    content: `Hello! I'm the Kitchen Pantry AI Assistant. I can help you with:

1. **Cost Estimation** - Get approximate pricing for your kitchen
2. **Design Suggestions** - Layout and style recommendations
3. **Material Selection** - Best materials for your budget
4. **Project Guidance** - Kitchen planning advice

How can I assist you today?`,
    model: 'rule-based',
    provider: 'offline',
  }
}
