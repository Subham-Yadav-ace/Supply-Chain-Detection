import React, { useEffect, useState } from 'react';
import { getScanResult } from '../api/client';
import DependencyTree from './DependencyTree';
import { FiAlertTriangle, FiCheckCircle, FiInfo, FiActivity, FiArrowLeft } from 'react-icons/fi';
import './ResultsDashboard.css';

function ResultsDashboard({ scanId, onNewScan }) {
  const [scan, setScan] = useState(null);
  const [selectedResult, setSelectedResult] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchScan = async () => {
      try {
        const data = await getScanResult(scanId);
        setScan(data);
        
        // Auto-select root package or highest risk package
        if (data.results && data.results.length > 0) {
          const rootResult = data.results.find(r => 
            data.dependencyTree.find(t => t.name === r.name && t.depth === 0)
          );
          
          if (rootResult) {
            setSelectedResult(rootResult);
          } else {
            // fallback to highest risk
            const sorted = [...data.results].sort((a, b) => b.riskScore - a.riskScore);
            setSelectedResult(sorted[0]);
          }
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    
    fetchScan();
  }, [scanId]);

  if (loading) return <div className="loading-state">Loading results...</div>;
  if (!scan) return <div className="error-state">Failed to load scan data.</div>;

  const handleNodeClick = (result) => {
    setSelectedResult(result);
  };

  return (
    <div className="dashboard-layout">
      <div className="dashboard-header">
        <h2>Scan Results: {scan.input.packageName || 'package.json'}</h2>
        <button className="secondary" onClick={onNewScan}>
          <FiArrowLeft /> New Scan
        </button>
      </div>

      <div className="dashboard-grid">
        <div className="tree-section glass-panel">
          <div className="section-header">
            <h3>Dependency Graph</h3>
            <span className="badge">{scan.uniquePackages || scan.totalPackages} Packages</span>
          </div>
          <DependencyTree 
            tree={scan.dependencyTree} 
            results={scan.results} 
            onNodeClick={handleNodeClick}
          />
        </div>

        <div className="details-section glass-panel">
          {selectedResult ? (
            <PackageDetails result={selectedResult} />
          ) : (
            <div className="empty-details">
              <FiInfo size={48} />
              <p>Click a package node to view detailed risk analysis.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PackageDetails({ result }) {
  const { name, version, riskScore, riskLevel, explanation, redFlags, sandboxFindings, staticFindings } = result;
  
  const getRiskClass = (score) => {
    if (score === -1) return 'error';
    if (score >= 76) return 'critical';
    if (score >= 51) return 'high';
    if (score >= 26) return 'medium';
    return 'low';
  };
  
  const riskClass = getRiskClass(riskScore);

  return (
    <div className="package-details">
      <div className="pkg-header">
        <div>
          <h3>{name}</h3>
          <span className="pkg-version">v{version}</span>
        </div>
        <div className={`risk-badge ${riskClass}`}>
          <span className="score">{riskScore === -1 ? 'ERR' : riskScore}</span>
          <span className="label">{riskLevel?.toUpperCase() || 'UNKNOWN'}</span>
        </div>
      </div>

      <div className="risk-explanation">
        <h4>AI Analysis</h4>
        <p>{explanation}</p>
      </div>

      {redFlags && redFlags.length > 0 && (
        <div className="red-flags-section">
          <h4><FiAlertTriangle className="icon-red" /> Identified Red Flags</h4>
          <ul>
            {redFlags.map((flag, i) => (
              <li key={i}>{flag}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="raw-findings">
        <h4><FiActivity className="icon-blue" /> Sandbox Activity</h4>
        <div className="findings-grid">
          <div className="finding-box">
            <span className="stat">{sandboxFindings?.network?.length || 0}</span>
            <span className="label">Network Calls</span>
          </div>
          <div className="finding-box">
            <span className="stat">{sandboxFindings?.fs?.writes?.length || 0}</span>
            <span className="label">File Writes</span>
          </div>
          <div className="finding-box">
            <span className="stat">{sandboxFindings?.envAccess?.length || 0}</span>
            <span className="label">Env Reads</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ResultsDashboard;
