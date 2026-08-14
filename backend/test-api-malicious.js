import axios from 'axios';
import fs from 'fs';
import path from 'path';

const API_URL = 'http://localhost:3001/api/scan';
const PACKAGE_DIR = path.resolve('../test-packages/malicious-demo-package');

async function testMaliciousScan() {
  console.log('Testing full scan on malicious demo package...');
  try {
    const pkgJsonPath = path.join(PACKAGE_DIR, 'package.json');
    const pkgJsonData = fs.readFileSync(pkgJsonPath, 'utf8');
    
    // We can simulate an upload of the package.json by sending it as a POST body
    // The backend `scan.js` route accepts application/json with { packageName } OR multipart, 
    // BUT since we're writing this quick script, let's just pass `packageJson`? 
    // Actually looking at scan.js, it expects multipart/form-data for files OR json with packageName.
    // Let's just create a FormData object to simulate a file upload.
    
    const FormData = (await import('form-data')).default;
    const form = new FormData();
    form.append('packageJson', fs.createReadStream(pkgJsonPath));

    const res = await axios.post(API_URL, form, {
      headers: form.getHeaders()
    });
    
    const { scanId } = res.data;
    console.log(`Scan started. Scan ID: ${scanId}`);

    let status = 'queued';
    let pollCount = 0;
    while (status !== 'complete' && status !== 'error' && pollCount < 20) {
      await new Promise(r => setTimeout(r, 2000));
      pollCount++;
      const res2 = await axios.get(`${API_URL}/${scanId}`);
      status = res2.data.status;
      console.log(`Poll ${pollCount}: Status = ${status}, Progress = ${res2.data.completedPackages}/${res2.data.totalPackages}`);
      
      if (status === 'complete') {
        console.log('✅ Scan completed successfully!');
        const result = res2.data.results.find(r => r.name === 'malicious-demo-package');
        
        console.log('\n--- Malicious Demo Package Scan Results ---');
        console.log(`Risk Score: ${result?.riskScore} (${result?.riskLevel})`);
        console.log(`Explanation:\n${result?.explanation}`);
        console.log('\nRed Flags:');
        result?.redFlags.forEach(f => console.log(` - ${f}`));
      }
    }
    
    if (status !== 'complete') {
      console.log('❌ Scan failed to complete in time or errored out.');
    }
  } catch (err) {
    console.error('Test failed:', err.response?.data || err.message);
  }
}

testMaliciousScan();
