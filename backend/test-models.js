import 'dotenv/config';
import { GoogleGenAI } from '@google/genai';
async function run() {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const response = await ai.models.listModels();
  for await (const m of response) {
    console.log(m.name);
  }
}
run().catch(console.error);
