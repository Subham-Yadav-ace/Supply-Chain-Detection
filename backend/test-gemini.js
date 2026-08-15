import 'dotenv/config';
import { scorePackage } from './src/ai-scoring/geminiClient.js';
async function test() {
  console.log("Key:", process.env.GEMINI_API_KEY ? "Loaded" : "Missing");
  const res = await scorePackage({}, {}, {});
  console.log(res);
}
test();
