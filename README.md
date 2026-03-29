# 🌳 Communitree Lead Generation API

Fast, secure lead generation system with MongoDB and Google Sheets sync.

## ⚡ Features

- **Lightning-fast duplicate detection** - O(1) MongoDB lookups (< 10ms)
- **Smart duplicate handling** - Shows old data, user confirms replacement
- **Google Sheets sync** - Auto-sync to spreadsheet for marketing team
- **Enterprise security** - Input sanitization, rate limiting, XSS protection
- **Beautiful UI** - Modern, responsive React form
- **Production-ready** - Full security implementation with monitoring

## 🏗️ Architecture

```
Frontend (React)  →  Backend (FastAPI)  →  MongoDB
                           ↓
                    Google Sheets (sync)
```

**Performance:**
- Old (Google Sheets): 500-1000ms+ with O(n) scanning
- New (MongoDB): <10ms with O(1) direct lookups

## 🚀 Quick Start

### Prerequisites
- Python 3.11+
- Node.js 18+
- MongoDB (or MongoDB Atlas account)
- Google Service Account (for Sheets sync)

### 1. Clone Repository
```bash
git clone https://github.com/YOUR_USERNAME/communitree-leads.git
cd communitree-leads
```

### 2. Backend Setup
```bash
cd backend

# Create virtual environment
python3 -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Configure environment
cp .env.example .env
# Edit .env with your settings

# Run backend
uvicorn server:app --host 0.0.0.0 --port 8001 --reload
```

### 3. Frontend Setup
```bash
cd frontend

# Install dependencies
yarn install

# Configure environment
cp .env.example .env
# Edit .env with backend URL

# Run frontend
yarn start
```

### 4. Google Sheets Setup (Optional)

1. Create Google Service Account
2. Download JSON credentials
3. Save as `backend/google_credentials.json`
4. Share your Google Sheet with service account email
5. Update `SPREADSHEET_ID` and `SHEET_NAME` in `.env`

## 📁 Project Structure

```
communitree-leads/
├── backend/
│   ├── server.py              # Main FastAPI application
│   ├── security.py            # Security utilities
│   ├── requirements.txt       # Python dependencies
│   ├── .env.example          # Environment template
│   └── google_credentials.json (add your own)
├── frontend/
│   ├── src/
│   │   ├── App.js            # Main React component
│   │   ├── App.css           # Styles
│   │   └── components/ui/    # Shadcn components
│   ├── package.json          # Node dependencies
│   └── .env.example          # Environment template
├── scripts/
│   └── security_test.sh      # Security testing script
├── SECURITY_GUIDE.md         # Complete security documentation
├── SECURITY_IMPLEMENTATION.md # Implementation details
├── DEPLOYMENT.md             # Deployment guide
└── README.md                 # This file
```

## 🔒 Security Features

✅ **Input Sanitization** - Removes dangerous characters  
✅ **Rate Limiting** - Prevents spam/DDoS  
✅ **NoSQL Injection Protection** - Strict validation  
✅ **XSS Protection** - Security headers  
✅ **Request Size Limits** - Max 50KB payloads  
✅ **Anomaly Detection** - Monitors suspicious activity  
✅ **Error Obfuscation** - No internal info exposed  
✅ **HTTPS Ready** - TLS/SSL support  

See `SECURITY_GUIDE.md` for complete details.

## 🌐 Deployment

### Option 1: Vercel + Railway (Recommended)
- **Frontend**: Deploy to Vercel (free)
- **Backend**: Deploy to Railway (free tier available)
- **Database**: MongoDB Atlas (free 512MB)

See `DEPLOYMENT.md` for step-by-step instructions.

### Option 2: All-in-One (Railway)
- Deploy entire stack to Railway
- Single platform management

### Option 3: Google Cloud / AWS
- Cloud Run / Lambda for serverless
- See deployment guide for details

## 🔧 Configuration

### Backend (.env)
```bash
MONGO_URL=mongodb://localhost:27017
DB_NAME=leads_database
CORS_ORIGINS=http://localhost:3000
GOOGLE_SHEETS_ENABLED=true
SPREADSHEET_ID=your-sheet-id
SHEET_NAME=Sheet1
API_KEY=your-api-key-here
```

### Frontend (.env)
```bash
REACT_APP_BACKEND_URL=http://localhost:8001
```

## 🧪 Testing

### Run Security Tests
```bash
bash scripts/security_test.sh
```

### Manual API Testing
```bash
# Health check
curl http://localhost:8001/api/

# Check duplicate
curl -X POST http://localhost:8001/api/check \
  -H "Content-Type: application/json" \
  -d '{"leadId":"TEST-001"}'

# Submit lead
curl -X POST http://localhost:8001/api/submit \
  -H "Content-Type: application/json" \
  -d '{
    "data": {
      "leadId":"TEST-001",
      "email":"test@example.com",
      "fullName":"Test User",
      "phone":"+1-555-0000",
      "company":"Test Co",
      "orgName":"Testing"
    },
    "replace":false
  }'
```

## 📊 API Endpoints

| Endpoint | Method | Description | Rate Limit |
|----------|--------|-------------|------------|
| `/api/` | GET | Health check | - |
| `/api/check` | POST | Check duplicate | 30/min |
| `/api/submit` | POST | Submit lead | 10/min |
| `/api/lead/{id}` | GET | Get specific lead | 60/min |
| `/api/leads` | GET | Get all leads (requires API key) | 10/min |

## 🎨 UI/UX

- **Modern design** with Tailwind CSS
- **Shadcn/UI components** for consistency
- **Responsive** mobile-friendly layout
- **Real-time validation** with error messages
- **Duplicate confirmation modal** with old data preview
- **Auto-form clearing** after successful submission

## 🤝 Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open Pull Request

## 📝 License

This project is licensed under the MIT License - see LICENSE file for details.

## 🙏 Acknowledgments

- FastAPI for the excellent Python framework
- MongoDB for fast NoSQL database
- React & Tailwind CSS for beautiful UI
- Shadcn/UI for component library
- Google Sheets API for data sync

## 📞 Support

- **Documentation**: See `/docs` folder
- **Security**: Read `SECURITY_GUIDE.md`
- **Deployment**: Follow `DEPLOYMENT.md`
- **Issues**: Open GitHub issue

## 🔄 Updates

**Version 2.0** (March 2026)
- ✅ Full security implementation
- ✅ Rate limiting
- ✅ Input sanitization
- ✅ Enhanced validation
- ✅ Anomaly detection
- ✅ Production-ready

**Version 1.0** (March 2026)
- ✅ Initial release
- ✅ MongoDB integration
- ✅ Google Sheets sync
- ✅ Duplicate detection

---

**Made with ❤️ for fast, secure lead generation**
