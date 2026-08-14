import axios from 'axios';
import fs from 'fs';

const API_URL = 'http://localhost:3001/api/scan';

async function testScan() {
  console.log('Testing single package scan (lodash)...');
  try {
    const res = await axios.post(API_URL, { packageName: 'lodash' });
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
    }
    
    if (status === 'complete') {
      console.log('✅ Scan completed successfully!');
    } else {
      console.log('❌ Scan failed to complete in time or errored out.');
    }
  } catch (err) {
    console.error('Test failed:', err.response?.data || err.message);
  }
}

testScan();
