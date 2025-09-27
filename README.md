# TrauMapp'd - Private Trauma Mapping & Exploration Tool

A self-hosted, privacy-focused application for mapping and exploring personal trauma using visual mind maps and AI-assisted reflection.

## Features

- **Complete Privacy**: All data stays on your device, encrypted at rest
- **Visual Trauma Mapping**: Interactive mind map for organizing experiences  
- **AI Exploration**: Local LLM for guided reflection (no internet required)
- **Trauma-Informed Design**: Built with safety, empowerment, and accessibility in mind
- **WCAG 2.1 AA Compliant**: Fully accessible interface
- **Export Options**: Share your map with therapists or backup your data

## Quick Start

### Prerequisites

- Docker and Docker Compose installed
- 8GB+ RAM (16GB recommended)
- 20GB+ free disk space

### Installation

1. Clone or download this repository:
```bash
git clone https://github.com/yourusername/traumappd.git
cd traumappd
```

2. Build the Docker container:
```bash
docker-compose up -d
```

3. Open your browser to: http://localhost:8000

4. Create your account (first-time setup only)

**Note**: On first run with AI features (Phase 3+), the AI model will download (~4GB). This ensures your conversations remain completely private but requires an initial internet connection.

## Usage

### Creating Your First Account

1. Navigate to http://localhost:8000
2. Enter a username and password
3. Click "Login" - this will create your account on first use
4. Your password encrypts all your data - keep it secure!

### Basic Navigation

- **Add Node**: Click the "Add Node" button to add entries to your map
- **Node Types**: Choose from 8 trauma-informed categories
- **Settings**: Customize themes, font size, and privacy options
- **Export**: Backup your data anytime

## Node Types

- **Trauma Event** (Red): Distressing experiences
- **Trigger** (Orange): Things that remind you of trauma
- **Response** (Yellow): How you react (fight/flight/freeze/fawn)
- **Symptom** (Purple): Current issues possibly rooted in trauma
- **Emotion** (Blue): Specific feelings
- **Belief** (Brown): Thoughts that arose from trauma
- **Coping** (Green): Strategies you use
- **Support** (Teal): Resources and support systems

## Privacy & Security

- **Encryption**: All sensitive data is encrypted using your password
- **Local Storage**: Nothing leaves your device
- **No Telemetry**: Zero tracking or analytics
- **Your Control**: Export or delete your data anytime

## Keyboard Shortcuts

- `Ctrl/Cmd + N`: Add new node
- `Escape`: Close modal dialogs
- `Tab`: Navigate between elements

## Crisis Resources

If you're in crisis, please reach out for immediate help:
- **988** - Suicide & Crisis Lifeline (US)
- **Text HOME to 741741** - Crisis Text Line
- **911** - Emergency services

## System Requirements

**Minimum:**
- 8GB RAM
- Dual-core CPU
- 20GB disk space

**Recommended:**
- 16GB RAM
- Quad-core CPU
- 50GB disk space

## Troubleshooting

### Container won't start
- Check Docker is running: `docker info`
- Check ports: Ensure 8000 isn't in use
- Check logs: `docker logs traumappd`

### Can't login
- Passwords are case-sensitive
- If you forgot your password, you'll need to reset the container
- Your data cannot be recovered without the password (it's encrypted)

## Backup & Restore

### Backup your data:
```bash
docker cp traumappd:/app/data ./backup-$(date +%Y%m%d)
```

### Restore from backup:
```bash
docker cp ./backup-folder traumappd:/app/data
```

## Development Status

This is Phase 1 (Foundation & Authentication) of the TrauMapp'd implementation:

- ✅ Phase 1: Docker container, FastAPI backend, authentication system
- 🚧 Phase 2: Mind map integration (coming next)
- 🚧 Phase 3: LLM integration for exploration
- 🚧 Phase 4: Map analysis features
- 🚧 Phase 5: Export, settings, and final polish

## Technical Architecture

- **Backend**: FastAPI (Python) with SQLAlchemy and encryption
- **Frontend**: Vanilla JavaScript with trauma-informed design
- **Database**: SQLite with Fernet encryption
- **Deployment**: Docker container for easy setup

## Disclaimer

TrauMapp'd is a self-help tool, not a replacement for professional therapy. If you're dealing with trauma, please consider working with a licensed mental health professional.

## License

MIT License - See LICENSE file for details

## Support

For issues, questions, or contributions:
- GitHub Issues: [Report bugs or request features]
- Remember: We cannot recover encrypted data if you lose your password

---

**Remember**: Your experiences are valid. Healing is not linear. Be gentle with yourself. 💚