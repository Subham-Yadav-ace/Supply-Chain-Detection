import axios from 'axios';

const api = axios.create({
  baseURL: '/api'
});

export const submitScan = async (payload) => {
  let data;
  let headers = {};
  
  if (payload instanceof File) {
    data = new FormData();
    data.append('packageJson', payload);
    headers['Content-Type'] = 'multipart/form-data';
  } else if (typeof payload === 'string') {
    data = { packageName: payload };
  } else {
    throw new Error('Invalid payload');
  }

  const res = await api.post('/scan', data, { headers });
  return res.data;
};

export const getScanResult = async (scanId) => {
  const res = await api.get(`/scan/${scanId}`);
  return res.data;
};

export const streamScanProgress = (scanId, onProgress, onComplete, onError) => {
  const evtSource = new EventSource(`/api/scan/${scanId}/stream`);

  evtSource.addEventListener('progress', (e) => {
    const data = JSON.parse(e.data);
    onProgress(data);
  });

  evtSource.addEventListener('complete', (e) => {
    const data = JSON.parse(e.data);
    onComplete(data);
    evtSource.close();
  });

  evtSource.addEventListener('error', (e) => {
    // Check if it's a parseable json error from the server
    try {
      if (e.data) {
        const data = JSON.parse(e.data);
        onError(data.message || 'Stream error');
      } else {
        onError('Lost connection to server');
      }
    } catch {
      onError('Stream connection failed');
    }
    evtSource.close();
  });

  return () => {
    evtSource.close(); // Cleanup function
  };
};
