# User Journey & Wireframes

## Flow 1: Setup & Registration
1. User deploys the Go binary to Railway.
2. User accesses the dashboard URL and authenticates with the Master Admin Secret.
3. User navigates to **"Key Pool"** and clicks **"Add Key"**.
4. User pastes a Gemini key. The backend validates it, hashes it, encrypts it via AES-256-GCM, and stores it in SQLite.
5. The dashboard updates to show the new key as `🟢 Healthy` with `15 RPM`.

## Flow 2: Application Integration
1. User goes to their Python project.
2. Instead of `api_key=os.getenv("GEMINI_KEY")`, they set `api_key="kc_master_token_123"`.
3. They change the base URL to `https://key-collective-production.up.railway.app/v1`.
4. The Python project acts exactly as if it's talking to OpenAI/Gemini directly.

## Flow 3: Dashboard Monitoring (Wireframe)
```text
+-------------------------------------------------------------+
| 🔑 Key Collective                 [Dashboard] [Keys] [Logs] |
+-------------------------------------------------------------+
|                                                             |
|  [ Total RPM Pool: 405 ]    [ Today's Requests: 1,204 ]     |
|                                                             |
|  ACTIVE KEYS                                                |
|  ---------------------------------------------------------  |
|  Provider | Prefix   | Health      | RPM     | Latency      |
|  Gemini   | AIzaSy...| 🟢 Healthy  | 4/15    | 450ms        |
|  Gemini   | AIzaSy...| 🔴 Cooldown | 15/15   | 600ms        |
|  Groq     | gsk_8x...| 🟢 Healthy  | 0/30    | 220ms        |
|                                                             |
|  RECENT LOGS                                                |
|  ---------------------------------------------------------  |
|  14:02:01 | Gemini | AIzaSy... | 200 OK | 340ms           |
|  14:01:55 | Gemini | AIzaSy... | 429 RL | 120ms (Failover)|
+-------------------------------------------------------------+
```
