export const AI_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    riskScore: { type: 'INTEGER', description: '0-100 score' },
    riskLevel: { type: 'STRING', description: 'Low, Medium, High, or Critical' },
    explanation: { type: 'STRING', description: 'Detailed explanation of the risk score' },
    redFlags: { type: 'ARRAY', items: { type: 'STRING' }, description: 'List of specific red flags' }
  },
  required: ['riskScore', 'riskLevel', 'explanation', 'redFlags']
};

export function buildPrompt(sandbox, staticAnalysis, registry) {
  const systemInstruction = `You are a strict Software Supply Chain Security Analyst.
Your job is to analyze the provided JSON findings for an npm package and return a JSON object evaluating its risk.
The analysis data includes:
1. Sandbox Findings: Network calls, file writes, and environment variable accesses captured dynamically during installation.
2. Static Analysis: Typosquatting checks, obfuscation scores (evals, base64), and metadata flags (new maintainers, version jumps).
3. Registry Data: Versions, timestamps, and maintainers.

Be highly suspicious of:
- Reading sensitive env vars (AWS, SSH, NPM_TOKEN).
- Spawning shells/curl/wget during installation.
- Writing to host paths like /etc/ or ~/.
- High obfuscation scores combined with network access.
- Brand new maintainers publishing major version jumps.

Your output must be strict JSON adhering to the provided schema.`;

  // Truncate logs if they get too large (prevent token overflow)
  const safeStr = (obj) => {
    const s = JSON.stringify(obj, null, 2) || '{}';
    return s.length > 15000 ? s.substring(0, 15000) + '\n... [TRUNCATED]' : s;
  };

  const prompt = `Please analyze the following package data and return the risk JSON:

### 1. Sandbox Findings (Install-time Behavior)
${safeStr(sandbox)}

### 2. Static Analysis Findings
${safeStr(staticAnalysis)}

### 3. Registry Metadata
${safeStr(registry)}
`;

  return { systemInstruction, prompt };
}
