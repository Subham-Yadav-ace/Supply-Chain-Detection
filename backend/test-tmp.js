import axios from 'axios';
async function run() {
  const { data } = await axios.post('http://localhost:3001/api/scan', { packageName: 'sentinel-resolve-tmp' });
  const scanId = data.scanId;
  while (true) {
    const res = await axios.get(`http://localhost:3001/api/scan/${scanId}`);
    if (res.data.status === 'complete') {
      console.log(JSON.stringify(res.data.results, null, 2));
      break;
    }
    await new Promise(r => setTimeout(r, 1000));
  }
}
run();
