export function parseAIScore(rawText) {
  try {
    // Attempt standard JSON parse
    // Sometimes models wrap in markdown ```json ... ```
    const clean = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
    const data = JSON.parse(clean);

    return {
      riskScore: typeof data.riskScore === 'number' ? data.riskScore : 50,
      riskLevel: data.riskLevel || 'Medium',
      explanation: data.explanation || 'No explanation provided.',
      redFlags: Array.isArray(data.redFlags) ? data.redFlags : [],
    };
  } catch (err) {
    console.warn('[Gemini] JSON parsing failed, attempting regex fallback:', err.message);
    
    // Regex fallback just in case the model failed to output strict JSON
    const scoreMatch = rawText.match(/riskScore["']?\s*:\s*(\d+)/i);
    const score = scoreMatch ? parseInt(scoreMatch[1], 10) : 50;
    
    let riskLevel = 'Medium';
    if (score >= 80) riskLevel = 'Critical';
    else if (score >= 60) riskLevel = 'High';
    else if (score < 30) riskLevel = 'Low';

    return {
      riskScore: score,
      riskLevel,
      explanation: 'AI response was malformed. Raw output: ' + rawText.substring(0, 200),
      redFlags: ['Failed to parse AI structured output']
    };
  }
}
