import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import UploadPanel from './components/UploadPanel';
import ScanProgress from './components/ScanProgress';
import ResultsDashboard from './components/ResultsDashboard';
import { FiShield } from 'react-icons/fi';
import './App.css';

function App() {
  // 'upload' | 'scanning' | 'results'
  const [appState, setAppState] = useState('upload');
  const [scanId, setScanId] = useState(null);

  const handleScanStarted = (id) => {
    setScanId(id);
    setAppState('scanning');
  };

  const handleScanComplete = () => {
    setAppState('results');
  };

  const handleNewScan = () => {
    setScanId(null);
    setAppState('upload');
  };

  return (
    <div className="app-container">
      <header className="app-header glass-panel">
        <div className="logo-container">
          <FiShield className="logo-icon" size={32} />
          <h1>SentinelChain</h1>
        </div>
        <div className="header-subtitle">Advanced Dependency Threat Intelligence</div>
      </header>

      <main className="app-main">
        <AnimatePresence mode="wait">
          {appState === 'upload' && (
            <motion.div
              key="upload"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.3 }}
              className="view-container"
            >
              <UploadPanel onScanStarted={handleScanStarted} />
            </motion.div>
          )}

          {appState === 'scanning' && scanId && (
            <motion.div
              key="scanning"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.4 }}
              className="view-container"
            >
              <ScanProgress 
                scanId={scanId} 
                onComplete={handleScanComplete} 
              />
            </motion.div>
          )}

          {appState === 'results' && scanId && (
            <motion.div
              key="results"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.5, type: 'spring' }}
              className="view-container dashboard-container"
            >
              <ResultsDashboard scanId={scanId} onNewScan={handleNewScan} />
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}

export default App;
