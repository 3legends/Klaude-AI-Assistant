<p align="center">
  <img src="https://github.com/user-attachments/assets/186d5458-7e8b-406a-9adc-ce755256298c" 
       alt="Group 14" 
       width="300" 
       style="padding: 10px; border-radius: 8px;"/>
</p>

# Klaude

**Professional Interview Assistant with Invisible Screen Overlay**

An AI-powered desktop tool that helps you excel in technical and professional interviews by providing intelligent, real-time assistance while remaining completely invisible to screen sharing and recording software.

### Demo
https://github.com/user-attachments/assets/c5616482-3652-4686-b87b-e04d06572d2f

## Perfect for Interviews
**Completely Stealth** - Invisible to Zoom, Teams, Meet, and all screen sharing tools
**Real-time AI Assistance** - Instant help with coding problems, system design, and interview questions
**Professional Skills** - Specialized modes for different interview types

### Supported Interview Skills
- **DSA (Data Structures & Algorithms)** - Complete solutions with complexity analysis
- **System Design** - Architecture patterns and scalability approaches  
- **Programming** - Multi-language coding assistance and best practices
- **Behavioral** - STAR method responses and professional scenarios
- **Sales** - Frameworks, objection handling, and closing techniques
- **Negotiation** - Strategic approaches and persuasion tactics
- **Presentation** - Structure, delivery tips, and visual design
- **DevOps** - Infrastructure, CI/CD, and deployment strategies
- **Data Science** - Analytics, ML approaches, and statistical methods

---

## 🚀 Quick Start

### Step 1 — Install system dependencies
```bash
brew install tesseract   # OCR for screenshot analysis
brew install sox         # Microphone capture for voice recording
brew install cmake       # Required to build Whisper (one-time, global)
```

### Step 2 — Clone and install
```bash
git clone <repository-url>
cd Klaude-ai-assistant
npm install
```

### Step 3 — Configure environment
Create a `.env` file in the project root:
```bash
# Google Gemini AI — get free key from https://makersuite.google.com/app/apikey
GEMINI_API_KEY=your_gemini_api_key_here

# Whisper Speech (optional overrides — defaults shown)
WHISPER_MODEL=base.en   # Options: tiny.en, base.en, small.en, medium.en, large
WHISPER_GPU=true        # Set to false to disable GPU acceleration
```

### Step 4 — ⚠️ One-time Whisper setup (required for voice feature)

Speech recognition runs **fully offline** using OpenAI Whisper — no API key or internet needed during use. But the model and binary must be built once before first use.

**Download the Whisper model (~141MB):**
```bash
node -e "const { nodewhisper } = require('nodejs-whisper'); nodewhisper('./eng.traineddata', { modelName: 'base.en', autoDownloadModelName: 'base.en' }).catch(()=>{})"
```

**Build the Whisper binary:**
```bash
cd node_modules/nodejs-whisper/cpp/whisper.cpp
cmake -B build -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_EXAMPLES=ON
cmake --build build --config Release
cd ../../../..
```

**Verify it worked:**
```bash
ls node_modules/nodejs-whisper/cpp/whisper.cpp/build/bin/
# You should see: whisper-cli
```

> ⚠️ **Important**: If you ever run `rm -rf node_modules && npm install`, you must redo Step 4. `brew install cmake` only needs to be done once per machine.

### Step 5 — Start the app
```bash
npm start
```

---

## 🔧 Essential Setup

### Google Gemini AI (required for AI responses)
- Get a free API key from [Google AI Studio](https://makersuite.google.com/app/apikey)
- Add to `.env`: `GEMINI_API_KEY=your_key`
- Or configure in-app: Press `Cmd+,` → Settings

### Whisper Speech (required for voice feature)
- **No API key needed** — runs 100% locally on your machine
- Follow the one-time setup in Step 4 above
- Model is cached after first download — subsequent starts are instant

---

## ⌨️ Essential Shortcuts

### Core Functions
| Shortcut | Action |
|----------|--------|
| `Cmd + Shift + S` | Screenshot + AI Analysis |
| `Alt/Option + R` | Voice Recording Toggle |
| `Cmd + Shift + \` | Show/Hide All Windows |
| `Alt + A` | Toggle Interactive Mode |

### Navigation
| Shortcut | Action |
|----------|--------|
| `Cmd + Shift + C` | Chat Window |
| `Cmd + Arrow Up/Down` | Skills Selection (only if Interactive mode is on) |
| `Cmd + ,` | Settings |

### Session Management
| Shortcut | Action |
|----------|--------|
| `Cmd+Shift+\` | Clear Session Memory |

### Important Interaction Usage Tip
* Enable **Interaction Mode** to scroll, click, or select inside windows.
* Use `Cmd+Up/Down` (in Interaction Mode) to switch skills quickly.
* Click through screen works only when interaction mode is disabled.
* In **Stealth Mode**, windows are invisible to screen share & mouse.

---

## 🔑 Key Features

### Stealth Technology
- **Invisible to Screen Sharing** - Completely hidden from Zoom, Teams, Meet
- **Process Disguise** - Appears as system process in Activity Monitor
- **Click-through Mode** - Windows become transparent to mouse clicks
- **No Screen Recording Detection** - Undetectable by recording software

### AI-Powered Analysis
- **Screenshot OCR** - Extract and analyze text from any screen content
- **Voice Commands** - Speak questions and get instant AI responses
- **Context-Aware** - Remembers conversation history for better responses
- **Multi-Format Output** - Clean text and code blocks with syntax highlighting

### Interview-Specific Intelligence
- **Problem Recognition** - Automatically detects interview question types
- **Step-by-Step Solutions** - Detailed explanations with best practices
- **Code Examples** - Multi-language implementations with optimizations

---

## 🏗️ Build Distributable App

### Build Commands
```bash
npm run build          # Current platform
npm run build:mac      # macOS (.dmg + .zip)
npm run build:win      # Windows (.exe installer + portable)
npm run build:linux    # Linux (.AppImage + .deb)
npm run build:all      # All platforms
```

**Built apps will be in the `dist/` folder:**
- **macOS**: `Klaude-1.0.0.dmg` or `Klaude-1.0.0-mac.zip`
- **Windows**: `Klaude Setup 1.0.0.exe` or `Klaude 1.0.0.exe`
- **Linux**: `Klaude-1.0.0.AppImage` or `Klaude_1.0.0_amd64.deb`

### Installing Built Apps
- **macOS**: Double-click `.dmg` → Drag to Applications folder
- **Windows**: Run `.exe` installer or double-click portable version
- **Linux**: `chmod +x Klaude.AppImage` and run, or `dpkg -i` for `.deb`

### Clean Build
```bash
rm -rf node_modules dist
npm install
# Re-run Whisper one-time setup (Step 4 above)
npm run build
```

---

## 🛠️ Troubleshooting

### Voice / Speech not working
**`cmake: command not found`**
```bash
brew install cmake
# Then re-run the cmake build steps in Step 4
```

**`whisper-cli` missing after cmake**
```bash
cd node_modules/nodejs-whisper/cpp/whisper.cpp
cmake --build build --config Release
```

**Speech fails after `rm -rf node_modules`**
The Whisper model and binary live inside `node_modules` and get wiped with it.
Re-run the full Step 4 setup after `npm install`.

**No transcription returned (silence detected)**
Speak clearly within 10 seconds of pressing `Alt+R`. The recording auto-stops after 10 seconds of silence.

### Screenshot / OCR not working
**No text extracted from screenshot**
```bash
brew install tesseract
# Verify: tesseract --version
```

### App won't start / crashes on launch
**`sox: command not found`**
```bash
brew install sox
# Verify: sox --version
```

### Gemini AI errors
**404 model not found**
Ensure your API key is valid at [Google AI Studio](https://makersuite.google.com/app/apikey).
The app uses `gemini-2.0-flash` — make sure your account has access.

**API key not working**
Check your `.env` file is in the project root and contains:
```bash
GEMINI_API_KEY=your_actual_key_here
```

---

## 💡 Pro Tips

### During Technical Interviews
1. **Position Windows**: Place Klaude windows in screen corners before sharing
2. **Use Voice Mode**: Press `Alt+R`, ask your question, press `Alt+R` again to process
3. **Screenshot Problems**: Capture coding challenges with `Cmd+Shift+S` for instant solutions
4. **Check Solutions**: Verify your approach with AI before implementing

### For System Design
1. **Capture Requirements**: Screenshot the problem statement for AI analysis
2. **Get Frameworks**: Ask for architectural patterns and trade-offs
3. **Verify Scalability**: Double-check your design decisions

### Behavioral Questions
1. **STAR Method**: Get structured response frameworks
2. **Industry Examples**: Request relevant scenarios for your field
3. **Follow-up Prep**: Prepare for common follow-up questions

---

## 📋 Technical Requirements

| Requirement | Version | Install |
|-------------|---------|---------|
| Node.js | 18+ | [nodejs.org](https://nodejs.org) |
| Tesseract OCR | any | `brew install tesseract` |
| Sox | any | `brew install sox` |
| CMake | any | `brew install cmake` |
| Google Gemini API | — | [AI Studio](https://makersuite.google.com/app/apikey) |

> **No Azure account needed.** Speech recognition is fully local via OpenAI Whisper.

---

## 🤝 Contributing

**Contribute to make Klaude the ultimate interview companion!**

### Priority Areas
- **New Interview Skills** - Add specialized domains (Finance, Marketing, etc.)
- **Language Support** - Expand beyond English for global users
- **Platform Extensions** - Windows and Linux compatibility
- **LLM Improvements** - Multiple LLM model selections for responses
- **UI/UX Improvements** - Enhanced interface and user experience

### How to Contribute
1. **Fork the repository**
2. **Star the project** if you find it useful
3. **Report issues** for bugs or feature requests
4. **Submit pull requests** for improvements
5. **Improve documentation** and add examples
6. **Share your success stories**

⭐ **Star this repo** if Klaude helped you ace your interviews or you vibed with it!