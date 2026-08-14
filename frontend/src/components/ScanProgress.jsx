import React, { useEffect, useState } from 'react';
import { streamScanProgress } from '../api/client';
import { FiTerminal, FiCheckCircle } from 'react-icons/fi';
import './ScanProgress.css';

function ScanProgress({ scanId, onComplete }) {
  const [progress, setProgress] = useState({
    status: 'queued',
    completedPackages: 0,
    totalPackages: 1,
    latestResults: []
  });
  
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!scanId) return;

    const cleanup = streamScanProgress(
      scanId,
      (data) => {
        setProgress(prev => ({ ...prev, ...data }));
      },
      (data) => {
        setProgress(prev => ({ ...prev, status: data.status }));
        if (data.status === 'complete') {
          // Give a short delay before transitioning so user sees 100%
          setTimeout(() => onComplete(), 1500);
        }
      },
      (errMsg) => {
        setError(errMsg);
      }
    );

    return cleanup;
  }, [scanId, onComplete]);

  const percentage = Math.round((progress.completedPackages / Math.max(progress.totalPackages, 1)) * 100);

  return (
    <div className="scan-progress-panel glass-panel">
      <div className="progress-header">
        <h2>Analyzing Dependencies</h2>
        <p className="scan-id">Scan ID: {scanId}</p>
      </div>

      <div className="progress-bar-container">
        <div className="progress-bar-bg">
          <div 
            className="progress-bar-fill" 
            style={{ width: `${percentage}%` }}
          />
        </div>
        <div className="progress-stats">
          <span>{progress.completedPackages} / {progress.totalPackages} Packages Scanned</span>
          <span>{percentage}%</span>
        </div>
      </div>

      <div className="terminal-container">
        <div className="terminal-header">
          <FiTerminal />
          <span>Live Analysis Logs</span>
        </div>
        <div className="terminal-body">
          {progress.latestResults.map((result, idx) => (
            <div key={`${result.name}-${idx}`} className="log-line">
              <span className="log-time">[{new Date().toLocaleTimeString()}]</span>
              <span className="log-action">ANALYZED</span>
              <span className="log-pkg">{result.name}@{result.version}</span>
              <span className={`log-score ${getRiskClass(result.riskScore)}`}>
                Score: {result.riskScore === -1 ? 'ERROR' : result.riskScore}
              </span>
            </div>
          ))}
          {progress.status === 'queued' && progress.completedPackages === 0 && (
            <div className="log-line">
              <span className="log-time">[{new Date().toLocaleTimeString()}]</span>
              <span className="log-info">Connecting to queue and spinning up sandboxes...</span>
            </div>
          )}
          {progress.status === 'complete' && (
            <div className="log-line success">
              <span className="log-time">[{new Date().toLocaleTimeString()}]</span>
              <FiCheckCircle className="inline-icon" />
              <span>Scan complete. Generating report...</span>
            </div>
          )}
        </div>
      </div>

      {error && <div className="error-message">{error}</div>}
    </div>
  );
}

function getRiskClass(score) {
  if (score === -1) return 'error';
  if (score >= 76) return 'critical';
  if (score >= 51) return 'high';
  if (score >= 26) return 'medium';
  return 'low';
}

export default ScanProgress;
