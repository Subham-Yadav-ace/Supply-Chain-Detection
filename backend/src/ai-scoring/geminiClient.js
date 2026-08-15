import { GoogleGenAI } from '@google/genai';
import { buildPrompt, AI_RESPONSE_SCHEMA } from './promptBuilder.js';
import { parseAIScore } from './scoreParser.js';

let ai = null;

function getAiClient() {
  if (!ai && process.env.GEMINI_API_KEY) {
    try {
      ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    } catch (e) {
      console.warn('[Gemini] Failed to initialize client:', e.message);
    }
  }
  return ai;
}

/**
 * Score a package using Gemini. Falls back to heuristic scoring if API key is missing.
 */
export async function scorePackage(sandboxFindings, staticFindings, registryMetadata) {
  const client = getAiClient();
  if (!client || !process.env.GEMINI_API_KEY) {
    console.warn('[Gemini] API key missing. Falling back to heuristic scoring.');
    return heuristicFallback(sandboxFindings, staticFindings);
  }

  const { systemInstruction, prompt } = buildPrompt(sandboxFindings, staticFindings, registryMetadata);

  let attempt = 0;
  const maxAttempts = 10;

  while (attempt < maxAttempts) {
    try {
      const response = await client.models.generateContent({
        model: 'gemini-3.5-flash',
        contents: prompt,
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
          responseSchema: AI_RESPONSE_SCHEMA,
        }
      });

      const text = response.text;
      return parseAIScore(text);

    } catch (err) {
      if (err.status === 429 || err.message.includes('429') || err.message.includes('Quota exceeded')) {
        attempt++;
        if (attempt >= maxAttempts) {
          console.error('[Gemini] Max retries reached for 429. Falling back.');
          return heuristicFallback(sandboxFindings, staticFindings);
        }
        console.warn(`[Gemini] Rate limit hit. Waiting 12 seconds before retry ${attempt}/${maxAttempts}...`);
        await new Promise(resolve => setTimeout(resolve, 12000));
      } else {
        console.error('[Gemini] Scoring failed:', err.message);
        return heuristicFallback(sandboxFindings, staticFindings);
      }
    }
  }
}

// ── Heuristic Fallback (when AI is disabled/fails) ────────────────────────────

function heuristicFallback(sandbox, st) {
  let score = 10;
  const redFlags = [];

  // Sandbox flags
  if (sandbox.networkCalls?.some(c => c.blocked)) {
    score += 40;
    redFlags.push('Unexpected outbound network connections during install');
  }
  if (sandbox.envAccess?.some(e => e.sensitive)) {
    score += 50;
    redFlags.push('Read sensitive environment variables (e.g. AWS_SECRET)');
  }
  if (sandbox.fileWrites?.some(w => w.path.startsWith('/etc/') || w.path.startsWith('/.ssh'))) {
    score += 60;
    redFlags.push('Attempted to write to sensitive host paths');
  }

  // Static flags
  if (st.typosquat?.flagged) {
    score += 40;
    redFlags.push(`Typosquatting: visually similar to ${st.typosquat.similarTo}`);
  }
  if (st.obfuscation?.obfuscationScore > 0.5) {
    score += 30;
    redFlags.push('High levels of obfuscated code detected (eval/base64)');
  }
  if (st.metadata?.newMaintainer) {
    score += 20;
    redFlags.push('New maintainer recently took over the package');
  }
  if (st.metadata?.versionJumpFlag) {
    score += 15;
    redFlags.push('Unusually large semver jump');
  }

  score = Math.min(Math.max(score, 0), 100);
  
  let riskLevel = 'Low';
  if (score >= 80) riskLevel = 'Critical';
  else if (score >= 60) riskLevel = 'High';
  else if (score >= 30) riskLevel = 'Medium';

  return {
    riskScore: score,
    riskLevel,
    explanation: 'Heuristic fallback scoring used (Gemini API disabled).',
    redFlags
  };
}
