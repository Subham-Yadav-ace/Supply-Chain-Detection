import 'dotenv/config';
import { GoogleGenAI } from '@google/genai';
async function run() {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const response = await ai.models.generateContent({
    model: 'gemini-3.5-flash',
    contents: 'Say hi'
  });
  console.log(response.text);
}
run().catch(console.error);
