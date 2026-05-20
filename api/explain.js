const GRADE_NAMES = ['Kindergarten','1st grade','2nd grade','3rd grade','4th grade','5th grade','6th grade','7th grade','8th grade'];

const SYSTEM_PROMPT = `You are a warm, patient math homework companion sitting at the kitchen table with a family. Your job is to bridge the gap between how children are taught math today and how their parents' generation learned it.

If an image is provided, read the homework problem from the image carefully before responding.

Respond ONLY with a single valid JSON object — no markdown, no code fences, no extra text.

Required shape:
{
  "title": "Short topic name (5 words or less)",
  "emoji": "One relevant emoji",
  "child": "Clear, friendly explanation using the MODERN method used in schools today. Appropriate for the grade level. Speak directly to the child. Use line breaks for readability.",
  "parent": "Explanation using the TRADITIONAL method the parent's generation likely used. Acknowledge kindly that things look different now. Bridge both approaches.",
  "example": {
    "problem": "A clear worked example problem",
    "steps": ["Step 1: ...", "Step 2: ...", "Step 3: ..."],
    "answer": "The final answer"
  },
  "practice": [
    { "problem": "Practice problem 1", "answer": "Answer 1" },
    { "problem": "Practice problem 2", "answer": "Answer 2" },
    { "problem": "Practice problem 3", "answer": "Answer 3" }
  ]
}

If the question is not about school math, return: { "error": "I can only help with math homework!" }`;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { credential, gradeIndex, question, image } = req.body || {};

  const googleClientId = process.env.GOOGLE_CLIENT_ID;
  const googleConfigured = googleClientId && googleClientId !== 'placeholder';

  if (googleConfigured) {
    if (!credential) return res.status(401).json({ error: 'REAUTH' });
    // Verify Google ID token
    try {
      const tokenRes = await fetch(
        `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`
      );
      const tokenData = await tokenRes.json();
      if (!tokenRes.ok || tokenData.error || !tokenData.sub) {
        return res.status(401).json({ error: 'REAUTH' });
      }
      if (tokenData.aud !== googleClientId) {
        return res.status(401).json({ error: 'REAUTH' });
      }
    } catch {
      return res.status(401).json({ error: 'REAUTH' });
    }
  }

  // Build Gemini request parts
  const parts = [];
  if (image && image.base64 && image.mimeType) {
    parts.push({ inline_data: { mime_type: image.mimeType, data: image.base64 } });
  }
  parts.push({
    text: `Grade: ${GRADE_NAMES[gradeIndex] || '3rd grade'}\nQuestion: ${question || 'Please read the homework problem in the image and help us understand it.'}`,
  });

  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) return res.status(500).json({ error: 'Server not configured' });

  try {
    const gemRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${geminiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts }],
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          generationConfig: { maxOutputTokens: 1500 },
        }),
      }
    );

    const data = await gemRes.json();

    if (!gemRes.ok) {
      return res.status(502).json({ error: data?.error?.message || 'AI service error' });
    }

    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    // Strip any accidental markdown fences
    const cleaned = rawText.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim();
    const parsed = JSON.parse(cleaned);

    if (parsed.error) return res.status(422).json({ error: parsed.error });
    return res.status(200).json(parsed);
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Unexpected error' });
  }
};
