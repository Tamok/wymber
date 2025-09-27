# TrauMapp'd - Copilot Implementation Instructions

## Project Overview

**TrauMapp'd** is a deeply sensitive trauma mapping and exploration tool that helps users visualize their trauma experiences through an interactive mind map and explore them with a local AI assistant. This is a privacy-first, trauma-informed mental health application.

### Core Values & Design Principles

- **Privacy First**: All data stays local, encrypted at rest, no telemetry or external connections
- **Trauma-Informed Design**: Safe, predictable, empowering, non-triggering interface
- **Complete Accessibility**: WCAG 2.1 AA compliant, keyboard navigable, screen reader friendly
- **User Control**: User owns their data completely, can delete anytime
- **Gentle Language**: Supportive, validating tone throughout - never clinical or judgmental

### Sensitivity Requirements

This tool will be used by vulnerable people dealing with trauma. Every design decision must prioritize:
1. **Safety** - No jarring animations, gentle transitions, clear exit options
2. **Privacy** - Local-only processing, strong encryption, no data collection
3. **Empowerment** - User controls their narrative, can modify/delete anything
4. **Accessibility** - Works for users with disabilities, various trauma responses

## Technical Architecture

### Stack Decisions

**Backend:**
- FastAPI (Python) - Fast, modern, automatic API docs
- SQLAlchemy - ORM with encryption capabilities
- Argon2 - Password hashing (OWASP recommended)
- Cryptography (Fernet) - Symmetric encryption using password-derived keys
- llama-cpp-python - Local LLM processing (no external API calls)

**Frontend:**
- Vanilla JavaScript - No framework dependencies, maximum performance
- MindElixir.js - Mind mapping library (trauma-adapted)
- WebSocket - Real-time streaming for AI responses
- CSS Grid/Flexbox - Responsive, accessible layout

**Database:**
- SQLite - Simple, local, no server required
- All sensitive data encrypted with user's password-derived key
- Automatic foreign key cascading for clean deletions

**Deployment:**
- Docker - Consistent environment, easy deployment
- Single container with all dependencies
- Volume mounts for persistent data and model storage

### Security Implementation

1. **Password Security**: Argon2 hashing with salt, never stored in plaintext
2. **Data Encryption**: Fernet (AES 128) with PBKDF2-derived keys from user password
3. **Session Management**: JWT tokens with configurable expiration
4. **No External Calls**: LLM runs locally, no internet required after setup
5. **Secure Defaults**: HTTPS-ready, localhost-only binding, no CORS issues

### LLM Integration Strategy

- **Model**: Llama 2 7B Chat (quantized Q4_K_M for efficiency)
- **First-Run Download**: ~4GB download on initial startup with progress indication
- **Privacy**: All processing local, no external API calls
- **Streaming**: WebSocket-based real-time response streaming
- **Context**: Maintains conversation history per node
- **Crisis Detection**: Built-in crisis keyword detection with resource provision

## 5-Phase Implementation Plan

### Phase 1: Foundation & Authentication
**Goal**: Docker container, FastAPI backend, authentication system

**Key Files:**
- `backend/main.py` - FastAPI app with CORS, static files, auth endpoints
- `backend/database.py` - SQLAlchemy models with encryption
- `backend/config.py` - Node types with trauma-informed descriptions
- `frontend/index.html` - Login screen and app skeleton
- `frontend/css/styles.css` - Trauma-informed styling with themes
- `frontend/js/auth.js` - Login/logout functionality
- `Dockerfile` & `docker-compose.yml` - Container setup
- `requirements.txt` - Python dependencies

**Checkpoint 1 Success Criteria:**
- Docker builds and runs successfully
- User can create account (first-run setup)
- Login/logout works with proper session management
- Password hashing and encryption key derivation functional
- Basic CSS with light theme applied
- No external network connections (except model download)

### Phase 2: Mind Map Integration
**Goal**: MindElixir integration, node CRUD operations, visual trauma map

**Key Files:**
- `frontend/js/mindmap.js` - Trauma-informed mind map wrapper
- `frontend/js/app.js` - Main application controller
- `frontend/js/api.js` - API client with error handling
- Enhanced `main.py` - Node/edge CRUD endpoints
- Enhanced `index.html` - Complete app structure with modals

**Checkpoint 2 Success Criteria:**
- Interactive mind map displays and saves automatically
- Can create all 8 trauma node types with appropriate colors/icons
- Node descriptions encrypted in database
- Keyboard navigation works (Tab, Enter, Delete keys)
- Visual feedback is gentle (no jarring transitions)
- Auto-save every 30 seconds with user notification

### Phase 3: LLM Integration - Explore Mode
**Goal**: Local LLM setup, single-node exploration chat

**Key Files:**
- `backend/llm_service.py` - Complete LLM service with trauma-informed prompting
- Enhanced `main.py` - WebSocket endpoints for streaming chat
- `frontend/js/chat.js` - Chat interface with streaming support
- Model download logic with progress indication

**Checkpoint 3 Success Criteria:**
- LLM model downloads on first run with progress bar
- Right-click any node → "Explore with AI" opens chat panel
- Chat responses stream in real-time (no blocking)
- Maintains conversation context per node
- Crisis detection works and shows resources
- Chat history saves encrypted and loads on return

### Phase 4: Map Analysis & Connect Mode
**Goal**: Full-map analysis to find patterns and insights

**Key Files:**
- `frontend/js/analysis.js` - Map analysis interface
- Enhanced `llm_service.py` - Map analysis prompting
- Enhanced `main.py` - WebSocket analysis endpoint

**Checkpoint 4 Success Criteria:**
- "Analyze Map" button triggers full map analysis
- Analysis identifies patterns across all nodes
- Points out coping resources and strengths
- Uses tentative, exploratory language ("perhaps", "might be")
- Results can be saved/exported as text file
- Analysis maintains trauma-informed approach

### Phase 5: Export, Settings & Polish
**Goal**: Export functionality, user settings, final accessibility

**Key Files:**
- `frontend/js/settings.js` - Complete settings management
- Enhanced `main.py` - Export/import endpoints, settings storage
- Enhanced `styles.css` - Multiple themes, font sizing, reduced motion
- Export functionality (JSON, PDF)

**Checkpoint 5 Success Criteria:**
- Export works (JSON with encrypted data, insights as PDF)
- Settings panel with themes (light/dark/soft), font sizes
- Crisis resources bar (can be disabled)
- Reduced motion preference respected
- Clear all data function with proper confirmation
- WCAG 2.1 AA compliance verified across all features

## File Structure

```
traumappd/
├── .github/instructions/copilot.instructions.md
├── backend/
│   ├── main.py           # FastAPI application
│   ├── database.py       # Models & encryption
│   ├── config.py         # Node types & constants
│   ├── llm_service.py    # LLM integration (Phase 3+)
│   └── auth.py           # Auth utilities (optional)
├── frontend/
│   ├── index.html        # Main HTML structure
│   ├── css/
│   │   └── styles.css    # Complete trauma-informed styling
│   ├── js/
│   │   ├── app.js        # Main controller
│   │   ├── api.js        # API client
│   │   ├── auth.js       # Authentication handling
│   │   ├── mindmap.js    # Mind map integration
│   │   ├── chat.js       # Chat interface (Phase 3+)
│   │   ├── analysis.js   # Map analysis (Phase 4+)
│   │   ├── settings.js   # Settings management (Phase 5+)
│   │   └── config.js     # Shared configuration
│   └── libs/
│       └── mind-elixir.min.js  # External library
├── models/               # LLM models (downloaded at runtime)
├── data/                 # User databases (gitignored)
├── Dockerfile
├── docker-compose.yml
├── requirements.txt
├── .gitignore
├── README.md
└── deploy.sh            # Optional deployment script
```

## Implementation Order & Dependencies

1. **Backend Foundation** - Database models, auth, basic endpoints
2. **Frontend Structure** - HTML layout, CSS theming, auth UI
3. **Docker Setup** - Container configuration, volume mounts
4. **Mind Map Integration** - Visual interface, node management
5. **LLM Service** - Local AI integration, streaming responses
6. **Analysis Features** - Pattern detection, insights generation
7. **Settings & Export** - User preferences, data export options
8. **Polish & Accessibility** - Final UX improvements, compliance testing

## Testing Approach

### Phase 1 Testing
- Docker build succeeds without errors
- Container starts and binds to localhost:8000
- First-run setup creates user account
- Login/logout cycle works
- Password hashing verifiable in database
- Encryption key derivation working

### Phase 2 Testing
- Mind map loads and displays correctly
- All 8 node types create with proper styling
- Nodes save to database encrypted
- Auto-save indicator updates correctly
- Keyboard shortcuts work (Ctrl+N, Delete, Tab navigation)
- No console errors in browser

### Phase 3 Testing
- LLM model downloads on first use (check progress display)
- Chat opens for any selected node
- AI responses stream smoothly without blocking
- Context maintained across conversation
- Crisis detection triggers with appropriate resources
- Chat history persists across sessions

### Phase 4 Testing
- Map analysis processes all nodes and edges
- Insights are helpful and appropriately tentative
- Analysis respects trauma-informed language
- Export functionality works correctly
- Large maps (20+ nodes) process without issues

### Phase 5 Testing
- All themes apply correctly (light/dark/soft)
- Font sizing affects all text appropriately
- Reduced motion disables animations
- Export/import cycle preserves data integrity
- Complete accessibility audit with screen reader

## Human QA Checkpoints

### Checkpoint 1 (After Phase 1)
**What to Test:**
- Docker build and container startup
- Account creation and login process
- Password security (verify hashing in DB)
- Basic UI responsiveness and theme
- No external network calls

**Expected Outcome:** Stable foundation ready for mind map integration

### Checkpoint 2 (After Phase 2)
**What to Test:**
- Create sample trauma map with 8-10 nodes of different types
- Test all node operations (create, edit, delete, move)
- Verify auto-save functionality
- Check keyboard accessibility
- Ensure gentle, non-triggering visual feedback

**Expected Outcome:** Functional mind mapping with trauma-informed design

### Checkpoint 3 (After Phase 3)
**What to Test:**
- LLM download process (first run)
- Node exploration conversations
- Crisis content detection
- Chat streaming and history
- Response quality and tone

**Expected Outcome:** AI assistant provides supportive, appropriate responses

### Checkpoint 4 (After Phase 4)
**What to Test:**
- Full map analysis with complex trauma map
- Pattern recognition accuracy
- Language appropriateness (tentative, not diagnostic)
- Export functionality
- Performance with large maps

**Expected Outcome:** Valuable insights without overstepping therapeutic boundaries

### Checkpoint 5 (Final QA)
**What to Test:**
- Complete user journey from setup to export
- All accessibility features (keyboard, screen reader)
- Theme switching and font scaling
- Data export/import cycle
- Crisis resources accessibility
- Complete privacy audit (no external calls)

**Expected Outcome:** Production-ready application meeting all trauma-informed criteria

## Key Decisions Made

### Why Local LLM?
- **Privacy**: No external API calls means user data never leaves device
- **Availability**: Works offline after initial setup
- **Control**: Can customize prompts specifically for trauma-informed responses
- **Trust**: Users don't need to trust external AI services with sensitive data

### Why Llama 2 7B Chat?
- **Size**: 4GB quantized model balances quality vs. resource usage
- **License**: Commercial use allowed
- **Quality**: Good conversational abilities for supportive responses
- **Performance**: Reasonable speed on consumer hardware

### Why Fernet Encryption?
- **Simplicity**: Easy to implement correctly
- **Strength**: AES-128 with authenticated encryption
- **Python Integration**: Native cryptography library support
- **Key Derivation**: Works well with password-based keys

### Why SQLite?
- **Simplicity**: No database server to manage
- **Reliability**: ACID compliance, crash safety
- **Performance**: Fast for single-user applications
- **Portability**: Easy to backup and migrate

### Why Vanilla JavaScript?
- **Performance**: No framework overhead
- **Simplicity**: Easier to audit for security/privacy
- **Compatibility**: Works in all modern browsers
- **Size**: Minimal download for users

## Crisis Management

### Crisis Content Detection
- Keyword scanning in user messages
- Immediate resource provision when detected
- Gentle, non-alarming presentation
- Always preserves user agency

### Crisis Resources
- 988 Suicide & Crisis Lifeline (US primary)
- Crisis Text Line (text-based option)
- SAMHSA National Helpline
- International resources (befrienders.org)

### Design Considerations
- Crisis bar can be shown/hidden per user preference
- Resources always accessible in help section
- Never lock users out or force crisis interventions
- Respect user's right to continue using the tool

## Accessibility Implementation

### WCAG 2.1 AA Compliance
- **Keyboard Navigation**: All functions accessible via keyboard
- **Screen Reader Support**: ARIA labels, semantic HTML, live regions
- **Color Contrast**: Minimum 4.5:1 ratio for all text
- **Focus Management**: Visible focus indicators, logical tab order
- **Resize Support**: Text readable at 200% zoom
- **Motion Sensitivity**: Respects prefers-reduced-motion

### Trauma-Specific Accessibility
- **Predictable Navigation**: Consistent layout and interactions
- **Clear Exits**: Easy way to close any dialog or return to safety
- **Gentle Transitions**: No sudden movements or jarring changes
- **Error Prevention**: Clear validation, helpful error messages
- **User Control**: User can control pace and depth of exploration

## Privacy Guarantees

### Data Handling
- **Encryption at Rest**: All sensitive data encrypted with user's password
- **Local Processing**: LLM runs entirely on user's device
- **No Telemetry**: Zero data collection or usage tracking
- **User Ownership**: Complete control over their data

### Security Measures
- **Password Hashing**: Argon2 with random salt
- **Session Security**: JWT with configurable expiration
- **Network Isolation**: Localhost binding, no external dependencies after setup
- **Secure Defaults**: All connections secured, minimal attack surface

## Performance Considerations

### System Requirements
- **Minimum**: 8GB RAM, 20GB disk space
- **Recommended**: 16GB RAM, 50GB disk space
- **CPU**: Multi-core preferred for LLM processing
- **GPU**: Optional but improves response speed

### Optimization Strategies
- **Quantized Model**: Q4_K_M reduces memory usage by ~75%
- **Streaming Responses**: Immediate feedback, no blocking waits
- **Auto-save Batching**: Reduces database writes
- **Lazy Loading**: Components load as needed

## Future Considerations

### Potential Enhancements
- **Voice Input**: Audio recording for difficult-to-type experiences
- **Therapist Sharing**: Secure export format for therapy sessions
- **Group Maps**: Family or group trauma mapping (with consent)
- **Integration**: Calendar reminders, journal entries
- **Analytics**: Personal insights dashboard

### Technical Improvements
- **GPU Support**: Faster LLM inference with CUDA
- **Model Updates**: Ability to upgrade AI model
- **Cloud Sync**: Optional encrypted cloud backup
- **Mobile App**: Native mobile version

## Success Metrics

### User Experience
- User can map trauma experiences without feeling triggered
- AI responses feel supportive and helpful
- Interface is accessible to users with various abilities
- Export functionality works for sharing with therapists

### Technical Performance
- Application starts within 30 seconds
- LLM responses begin within 10 seconds
- Interface handles 50+ nodes without lag
- Memory usage stays under 8GB during normal operation

### Privacy & Security
- No external network connections during normal use
- All sensitive data encrypted and inaccessible without password
- Complete data deletion works as expected
- Security audit reveals no data leaks or vulnerabilities

## Support & Maintenance

### Documentation
- Complete README with setup instructions
- User guide for trauma survivors
- Technical documentation for developers
- Crisis resources prominently displayed

### Issue Handling
- Clear bug reporting process
- Sensitive issue handling procedures
- Community guidelines for respectful support
- Professional therapy resource recommendations

---

**Remember**: This application will be used by people in vulnerable states dealing with trauma. Every implementation decision should prioritize their safety, privacy, and emotional wellbeing. When in doubt, choose the more conservative, supportive, and secure option.

The code provided in the specification is comprehensive and should be implemented as-is, with minor improvements for code quality where appropriate. The trauma-informed design principles must be maintained throughout all implementation phases.