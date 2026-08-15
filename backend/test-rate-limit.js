import 'dotenv/config';
import { GoogleGenAI } from '@google/genai';
async function test() {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  for (let i = 0; i < 7; i++) {
    try {
      await ai.models.generateContent({
        model: 'gemini-flash-latest',
        contents: 'hi'
      });
      console.log('Success', i);
    } catch (e) {
      console.log('Error', i, e.message);
    }
  }
}
test();
