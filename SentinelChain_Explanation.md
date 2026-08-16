# SentinelChain: Complete Technical Explanation & Architecture

This document provides a deep dive into the inner workings, system architecture, and technical design decisions of **SentinelChain**, an AI-powered npm supply chain security scanner.

---

## 1. Executive Summary

SentinelChain is designed to protect developers from malicious npm packages (e.g., typosquatting, hidden malware, account takeovers, malicious post-install scripts). Rather than just relying on known vulnerability databases (CVEs), SentinelChain actively *investigates* packages using dynamic sandbox execution, static code analysis, and large language models (Google Gemini) to detect zero-day supply chain threats.

When a user submits a `package.json` file, the system resolves the entire transitive dependency tree and analyzes each individual package in an isolated Docker container, scoring it from 0 (Safe) to 100 (Critical Risk).

---

## 2. High-Level Architecture

The system is built on a microservices-inspired architecture designed for parallel processing of dependency trees.

```mermaid
graph TD
    Client[Frontend (React + Vite)] -->|HTTP POST package| API[Express.js Backend]
    API -->|Resolves Dependencies & Enqueues| Queue[BullMQ (Redis)]
    API -->|SSE Progress Stream| Client
    
    Queue -->|Pulls Uncached Packages| Worker[BullMQ Worker (Node.js)]
    
    Worker -->|1. Dynamic Sandbox| Docker[Docker Container]
    Worker -->|2. Static Analysis| Static[Obfuscation & Typosquat]
    Worker -->|3. Registry Checks| Meta[Metadata Flags]
    
    Docker -->|Findings| AI[Gemini AI Scoring]
    Static -->|Findings| AI
    Meta -->|Findings| AI
    
    AI -->|Risk JSON| Worker
    Worker -->|Saves Results| DB[(MongoDB)]
    Worker -->|Caches| Cache[(Redis)]
```

### Core Components

1.  **Frontend (React + Vite)**: 
    *   Provides the user interface.
    *   Manages drag-and-drop file uploads.
    *   Consumes Server-Sent Events (SSE) for real-time progress updates.
    *   Renders the final interactive dependency graph and detailed package reports.
2.  **Backend (Express.js)**: 
    *   Exposes REST APIs for scan submission (`POST /api/scan`) and retrieval (`GET /api/scan/:scanId`).
    *   Handles transitive dependency tree resolution.
    *   Manages the Server-Sent Events (SSE) stream (`GET /api/scan/:scanId/stream`).
3.  **Message Queue (BullMQ + Redis)**: 
    *   Since a single `package.json` can result in hundreds of dependencies, the backend queues each unique package for analysis.
    *   Redis serves as the backing store for BullMQ and acts as a caching layer for already-analyzed packages.
4.  **Worker Process (Node.js + Dockerode)**: 
    *   Consumes jobs from the BullMQ queue.
    *   Executes the heavy lifting: Sandbox execution, Static Analysis, and AI Scoring.
5.  **Database (MongoDB)**: 
    *   Stores the final `ScanResult` documents, tracking the overall progress of a scan and holding the final risk scores and red flags for the dashboard.

---

## 3. The Data Flow: Step-by-Step

Here is the exact lifecycle of a scan request:

1.  **Ingestion & Resolution**: 
    *   The user uploads a `package.json`.
    *   The Backend uses `npm install --package-lock-only` in a temporary directory to generate a lockfile, allowing it to resolve the full transitive dependency tree without actually downloading all the code.
2.  **Caching Strategy**: 
    *   The resolved tree yields a list of unique packages (e.g., `lodash@4.17.21`).
    *   The Backend checks Redis. If `lodash@4.17.21` was scanned previously, its cached result is immediately added to the final report.
    *   Any uncached packages are added to the BullMQ queue as individual jobs.
3.  **Parallel Execution**: 
    *   The Worker picks up a job (e.g., `axios@1.4.0`).
    *   It triggers the **Dynamic Sandbox**, **Obfuscation Check**, **Typosquatting Check**, and **Metadata Check** simultaneously (`Promise.all`).
4.  **AI Aggregation**: 
    *   The findings from the static and dynamic analyses are converted into a JSON string.
    *   This string is sent to Google Gemini with a strict system prompt instructing it to act as a security analyst.
5.  **Result Storage**: 
    *   Gemini returns a structured JSON object containing a `riskScore` (0-100), `riskLevel`, `explanation`, and `redFlags`.
    *   The result is cached in Redis and appended to the `ScanResult` document in MongoDB.
6.  **Streaming to Client**: 
    *   While the worker processes jobs, the Express server constantly polls MongoDB and streams the `completedPackages` count back to the Frontend via SSE, updating the live progress bar.

---

## 4. Deep Dive into Analysis Stages

The core intelligence of SentinelChain lives in the Worker, which runs three distinct phases of analysis.

### Stage 1: Dynamic Docker Sandbox Isolation

*Where it lives: `backend/src/sandbox/`*

To catch malicious install scripts (like `preinstall` or `postinstall`), SentinelChain physically installs the package inside an isolated Docker container (`sentinelchain-sandbox:latest`).

*   **Isolation Specs**: Node 20 Alpine base, non-root user (`sandboxuser`), 256MB memory limit, 128 PID limit (prevents fork bombs), and no network routing to the host machine.
*   **Syscall Tracing (`strace`)**: Monitors all OS-level calls made during `npm install`.
*   **Preload Scripts**: Uses Node's `--require` flag to inject `env-monitor.js` and `runtime-monitor.js` before the package runs.
    *   `env-monitor.js`: Hooks into `process.env` to detect if the package is trying to steal AWS credentials, SSH keys, or NPM tokens.
    *   `runtime-monitor.js`: Hooks into the `net` and `fs` modules.
*   **Detection Goals**: Flags unauthorized network connections (anything not going to `registry.npmjs.org`), attempts to write to `/etc/` or `~/.ssh/`, or the spawning of suspicious child processes like `curl`, `wget`, or `bash`.

### Stage 2: Static Analysis

*Where it lives: `backend/src/static-analysis/`*

While the sandbox watches behavior, static analysis inspects the code and metadata without running it.

1.  **Obfuscation Detection (`obfuscation.js`)**:
    *   Downloads the package tarball and extracts it.
    *   Scans all `.js` files using Abstract Syntax Tree (AST) parsing via `acorn`.
    *   Flags highly suspicious patterns like `eval(<dynamic_content>)`, `new Function()`, `Buffer.from(x, 'base64')`, and lines of code with extremely high Shannon Entropy (which indicates packed or encrypted malware).
2.  **Typosquatting Detection (`typosquat.js`)**:
    *   Uses the `fastest-levenshtein` library to calculate the string distance between the submitted package name and a bundled database of the top 2,000 most popular npm packages.
    *   If a package name is just 1 or 2 characters off from a major library (e.g., `react-dom` vs `react-don`), it flags it as a high-probability typosquatting attempt.
3.  **Metadata Flags (`metadataFlags.js`)**:
    *   Queries the npm registry API for historical publish data.
    *   **Account Takeover Signals**: Flags if the maintainer who published the current version is completely new and has never published a previous version of this package.
    *   **Suspicious Activity**: Flags massive version jumps (e.g., v1.0.0 directly to v4.0.0) or sudden publishes after years of dormancy.

### Stage 3: Gemini AI Risk Scoring

*Where it lives: `backend/src/ai-scoring/`*

Traditional scanners use hardcoded rules, which are easily bypassed. SentinelChain uses an LLM to analyze the *context* of the findings.

*   The findings from the Sandbox and Static Analysis are compiled into a large JSON object.
*   It is sent to the `gemini-2.5-flash` model.
*   **System Prompt**: Instructs the model to evaluate the JSON data, looking for dangerous correlations (e.g., "The package has a high obfuscation score AND it made an outbound network call to an unknown IP during install").
*   **Structured Output**: The model is forced to reply with a strict JSON schema:
    ```json
    {
      "riskScore": 85,
      "riskLevel": "Critical",
      "explanation": "Package attempted to read AWS environment variables and transmit them to a non-registry IP address.",
      "redFlags": [
        "Sensitive environment variable read (AWS_SECRET_ACCESS_KEY)",
        "Outbound network connection to 192.168.x.x"
      ]
    }
    ```
*   **Heuristic Fallback**: If the Gemini API is unreachable or rate-limited, the system seamlessly falls back to a hardcoded mathematical heuristic function to ensure the scan still completes.

---

## 5. Infrastructure & Deployment Design

*   **Docker Compose**: The `docker-compose.yml` file provisions the underlying stateful services (Redis 7 and MongoDB 7).
*   **Ephemeral Sandboxes**: The Node.js backend programmatically interacts with the host's Docker daemon via the `dockerode` library, spinning up and tearing down sandbox containers on the fly for every single package analyzed.

This architecture ensures high scalability. By simply increasing the `WORKER_CONCURRENCY` environment variable and providing more compute power, SentinelChain can analyze hundreds of dependencies in parallel.
