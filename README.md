# 🚀 PinClip Server

Backend service for **PinClip** — a secure temporary file and text sharing platform using a **4-digit PIN**.

The server handles **file uploads, PIN generation, temporary storage, and secure retrieval** of shared content.

---

# ✨ Features

🔐 **4-Digit Secure PIN**
Each upload generates a random PIN used to access the content.

⏳ **Temporary Storage**
Uploaded content automatically expires after a short duration.

📦 **File & Text Support**
Users can share both text snippets and files.

⚡ **Fast API**
Built with **Node.js + Express** for lightweight and fast performance.

🐳 **Docker Ready**
Includes Docker configuration for easy containerized deployment.

☁️ **Fly.io Deployment**
Configured with `fly.toml` for quick deployment to Fly.io.

---

# 🧰 Tech Stack

| Technology | Purpose              |
| ---------- | -------------------- |
| Node.js    | Backend runtime      |
| Express    | API framework        |
| Multer     | File upload handling |
| Docker     | Containerization     |
| Fly.io     | Cloud deployment     |

---

# 📁 Project Structure

```bash
server
│
├── index.js            # Main server entry point
├── package.json        # Dependencies & scripts
├── package-lock.json
│
├── Dockerfile          # Docker container setup
├── fly.toml            # Fly.io deployment configuration
│
├── .env.example        # Environment variables example
├── .gitignore
├── .gitattributes
└── .dockerignore
```

---

# ⚡ Getting Started

### 1️⃣ Install Dependencies

```bash
npm install
```

### 2️⃣ Start the Server

```bash
node index.js
```

Server will run at:

```
http://localhost:5000
```

---

# 🔑 Environment Variables

Create a `.env` file based on `.env.example`.

Example:

```
PORT=5000
MAX_FILE_SIZE=20MB
PIN_EXPIRY=600
```

---

# 📡 API Endpoints

### Upload Content

```
POST /upload
```

Upload text or file.

Response:

```json
{
  "pin": "4831",
  "expires_in": "10 minutes"
}
```

---

### Retrieve Content

```
POST /retrieve
```

Request:

```json
{
  "pin": "4831"
}
```

Response:

```json
{
  "type": "text",
  "content": "Hello world"
}
```

or

```json
{
  "type": "file",
  "download_url": "/download/4831"
}
```

---

# 🐳 Docker Setup

Build Docker image:

```bash
docker build -t pinclip-server .
```

Run container:

```bash
docker run -p 5000:5000 pinclip-server
```

---

# ☁️ Deploy to Fly.io

Deploy using Fly CLI:

```bash
fly deploy
```

Your backend will be live on Fly.io.

---

# 🛡 Security Features

• 4-digit PIN validation
• Automatic content expiration
• File size limit protection
• Secure file handling

---

# 📜 License

MIT License

---

⭐ If you like this project, consider **starring the repository**!
