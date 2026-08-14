import React, { useState, useRef } from 'react';
import { FiUploadCloud, FiSearch, FiLoader } from 'react-icons/fi';
import { submitScan } from '../api/client';
import './UploadPanel.css';

function UploadPanel({ onScanStarted }) {
  const [isDragging, setIsDragging] = useState(false);
  const [packageName, setPackageName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const fileInputRef = useRef(null);

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const processSubmission = async (payload) => {
    setLoading(true);
    setError(null);
    try {
      const result = await submitScan(payload);
      onScanStarted(result.scanId);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Scan submission failed');
      setLoading(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      processSubmission(files[0]);
    }
  };

  const handleFileChange = (e) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      processSubmission(files[0]);
    }
  };

  const handleTextSubmit = (e) => {
    e.preventDefault();
    if (packageName.trim()) {
      processSubmission(packageName.trim());
    }
  };

  return (
    <div className="upload-panel glass-panel">
      <div className="upload-header">
        <h2>Start a Security Scan</h2>
        <p>Analyze npm packages for obfuscation, typosquatting, and dynamic sandbox behavior.</p>
      </div>

      <div 
        className={`drop-zone ${isDragging ? 'dragging' : ''} ${loading ? 'disabled' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => !loading && fileInputRef.current.click()}
      >
        <FiUploadCloud className="drop-icon" />
        <h3>Drag & Drop package.json</h3>
        <p>or click to browse local files</p>
        <input 
          type="file" 
          ref={fileInputRef} 
          style={{ display: 'none' }} 
          accept="application/json,.json,.tgz"
          onChange={handleFileChange}
          disabled={loading}
        />
      </div>

      <div className="divider">
        <span>OR</span>
      </div>

      <form className="text-input-form" onSubmit={handleTextSubmit}>
        <div className="input-group">
          <FiSearch className="input-icon" />
          <input 
            type="text" 
            placeholder="Enter public npm package name (e.g. lodash)" 
            value={packageName}
            onChange={(e) => setPackageName(e.target.value)}
            disabled={loading}
          />
          <button type="submit" disabled={!packageName.trim() || loading}>
            {loading ? <FiLoader className="spin" /> : 'Scan Public Package'}
          </button>
        </div>
      </form>

      {error && <div className="error-message">{error}</div>}
    </div>
  );
}

export default UploadPanel;
