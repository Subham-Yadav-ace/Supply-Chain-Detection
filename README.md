# SentinelChain

**AI-Powered npm Supply Chain Security Scanner**

SentinelChain is an advanced, automated security scanner designed to detect malicious npm packages. It analyzes packages through a multi-staged pipeline that includes dynamic sandbox execution, static code analysis, and Google Gemini AI risk scoring, providing a 0–100 risk score and detailed red flag reports for every transitive dependency in your project.

---

## 🚀 Key Features

*   **Deep Dependency Resolution**: Analyzes the entire transitive dependency tree (not just direct dependencies) using `npm --package-lock-only`.
*   **Stage 1: Dynamic Docker Sandbox Isolation**: Every package is installed in an isolated Node 20 Alpine container.
    *   Traces system calls using `strace` (or preload fallbacks).
    *   Monitors outbound network connections, blocking non-registry IPs.
    *   Detects unauthorized file system writes (e.g., to `/etc/` or `~/.ssh`).
    *   Intercepts sensitive environment variable reads (e.g., `AWS_SECRET_ACCESS_KEY`, `NPM_TOKEN`).
*   **Stage 2: Static Analysis**:
    *   **Obfuscation Detection**: Uses AST walking (`acorn`) and Regex to find `eval()`, Base64 payloads, high-entropy lines, and hidden execution logic.
    *   **Typosquatting Check**: Calculates Levenshtein distance against a built-in database of the top 2,000 npm packages to catch deceptive names (e.g., `lodas` vs `lodash`).
    *   **Metadata Flags**: Analyzes npm registry data for account-takeover signals like brand-new maintainers, major version jumps, or sudden activity after years of dormancy.
*   **Stage 3: Gemini AI Risk Scoring**: Combines all findings into a structured prompt for Google Gemini (2.5 Flash), outputting a strict JSON risk assessment containing a 0–100 score, risk level (Low/Medium/High/Critical), explanation, and a list of specific red flags.
*   **Real-time UI Dashboard**: Built with React and Vite. Features drag-and-drop `package.json` upload, live Server-Sent Events (SSE) streaming of scan progress, and an interactive dependency graph visualization.

---

## 🏗️ Architecture & Tech Stack

### Tech Stack
*   **Frontend**: React 18, Vite, Framer Motion, React Icons
*   **Backend**: Node.js (ESM), Express.js
*   **Queue/Workers**: BullMQ, Redis 7
*   **Database**: MongoDB 7, Mongoose
*   **Analysis Tools**: Dockerode, strace, acorn, fastest-levenshtein
*   **AI**: `@google/genai` (Google Gemini)

### Data Flow
1.  **Ingestion**: User uploads `package.json`. Backend resolves the full dependency tree.
2.  **Queueing**: Unique uncached dependencies are enqueued to BullMQ.
3.  **Parallel Analysis**: BullMQ workers pick up jobs and run Docker Sandbox, Obfuscation checks, and Typosquat checks concurrently.
4.  **AI Evaluation**: The aggregated findings are sent to Gemini AI for scoring.
5.  **Storage & Caching**: Results are saved to MongoDB and cached in Redis.
6.  **Streaming Delivery**: The frontend receives real-time progress via Server-Sent Events (SSE) and displays the final interactive dashboard.

---

## 🛠️ Setup and Installation

### Prerequisites
*   Node.js (v18 or v20+)
*   Docker & Docker Compose (required for Redis, MongoDB, and Sandbox containers)
*   A Google Gemini API Key

### 1. Clone the repository
```bash
git clone https://github.com/Subham-Yadav-ace/Supply-Chain-Detection.git
cd Supply-Chain-Detection
```

### 2. Environment Setup
Create a `.env` file in the `backend/` directory based on the `.env.example`:

```bash
# backend/.env

PORT=3001
NODE_ENV=development

# MongoDB
MONGO_URI=mongodb://localhost:27017/sentinelchain

# Redis (BullMQ)
REDIS_URL=redis://localhost:6379

# Google Gemini API
GEMINI_API_KEY=your_gemini_api_key_here

# Sandbox Config
SANDBOX_TIMEOUT_MS=90000
SANDBOX_MEMORY_MB=256

# Worker Config
WORKER_CONCURRENCY=4
```

### 3. Start Infrastructure (Redis & MongoDB)
```bash
docker-compose up -d
```

### 4. Install Dependencies
**Backend:**
```bash
cd backend
npm install
```

**Frontend:**
```bash
cd ../frontend
npm install
```

### 5. Start the Application
You need two terminal windows:

**Terminal 1 (Backend & Worker):**
```bash
cd backend
npm run dev
```
*(On the first run, the backend will automatically build the `sentinelchain-sandbox:latest` Docker image. This may take a minute.)*

**Terminal 2 (Frontend):**
```bash
cd frontend
npm run dev
```

The frontend will be available at `http://localhost:5173`.

---

## 🧪 Usage

1. Open `http://localhost:5173` in your browser.
2. Drag and drop your project's `package.json` file into the upload zone, OR type the name of a public npm package (e.g., `lodash`, `express`).
3. Watch the real-time terminal stream as SentinelChain provisions sandboxes, analyzes code, and consults Gemini AI.
4. Review the final dashboard:
   *   Explore the Dependency Tree.
   *   Click on nodes (packages) to view detailed AI explanations, sandbox metrics (network, fs, env reads), and identified red flags.

---

## 🔮 Future Roadmap

*   **Phase 1 (Near-Term)**: CI/CD Pipeline Integration (GitHub Actions) to block PRs introducing critical packages; VS Code Extension for inline `package.json` warnings.
*   **Phase 2 (Mid-Term)**: Multi-ecosystem support (PyPI, Maven); network-level packet capture via `tcpdump`; SBOM (Software Bill of Materials) export.
*   **Phase 3 (Long-Term)**: SaaS platform API; community threat intelligence feed; browser extension for npmjs.com.

---

## 📄 License

This project is open-source and available under the MIT License.
