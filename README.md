# SmartParkk - Smart Parking Management System

> A complete parking management solution with resident approval workflow, real-time tracking, and automated charge calculation.

## 🎯 Overview

SmartParkk is a modern parking management system designed for apartment complexes and gated communities. It automates the visitor approval process, tracks parking usage in real-time, calculates charges, and provides role-based dashboards for residents, visitors, and administrators.

**Status**: ✅ **Deployed and Running 24/7 on Railway.app**

## 🌐 Live Deployment

| Portal | URL |
|--------|-----|
| **Visitor App** | https://smartparkk-production.up.railway.app/ |
| **Resident Portal** | https://smartparkk-production.up.railway.app/resident.html |
| **Admin Dashboard** | https://smartparkk-production.up.railway.app/admin.html |

## ✨ Key Features

### 👤 Visitor App
- Phone-based registration with WhatsApp OTP verification
- Select visiting flat and estimated parking duration
- Real-time available parking spots display
- Live parking charge calculation
- Exit confirmation with detailed receipt
- Automatic fine (₹50) for exceeding estimated time
- WhatsApp notifications for: OTP, parking reminders, charges

### 🏠 Resident Portal
- Approve/deny visitor entry requests in real-time
- Block persistent visitors from future entries
- Mark availability status (available/unavailable)
- **Progressive Web App** - Install as mobile app
- Live notifications for new access requests

### 👨‍💼 Admin Dashboard
- **Live Dashboard**: Real-time visitor tracking & analytics
- **Gate Control**: Manage access requests with live notifications
- **Exit Camera**: OCR-powered plate recognition for automatic exit processing
- **Resident Management**: View and manage resident profiles
- **Blocked Visitors**: Comprehensive block list management
- **Settings**: Configure hourly rates, Time-based fine amounts, total parking capacity
- **Revenue Tracking**: Monthly revenue analytics

## 🛠️ Tech Stack

### Frontend
- **Vanilla JavaScript** - No frameworks, lightweight & fast
- **Responsive Design** - Works on desktop, tablet, mobile
- **Service Worker** - PWA support for resident portal
- **Tesseract.js** - Client-side OCR for plate recognition

### Backend
- **Node.js & Express** - Lightweight server
- **Supabase** - PostgreSQL database + authentication
- **Web.js** - WhatsApp Business integration
- **Web Push API** - Push notifications

### Deployment
- **Docker** - Containerized application
- **Railway.app** - 24/7 cloud hosting with auto-deploy
- **GitHub** - Version control & CI/CD integration

## 📊 Database Schema

### Tables
- `visitors` - Parking session records
- `residents` - Resident profiles & car information
- `gate_notifications` - Real-time access requests
- `blocked_visitors` - Blocked visitor management
- `push_subscriptions` - PWA notification subscriptions

## 🚀 Quick Start

### Local Development

**Prerequisites**: Node.js 20+, npm

```bash
# Clone repository
git clone https://github.com/itsNooms/smartparkk.git
cd smartparkk

# Install backend dependencies
cd backend
npm install

# Create environment file
cp ../.env.example .env
# Edit .env with your Supabase & VAPID keys

# Start backend server
node server.js

# Open in browser
# http://localhost:3000 (Visitor)
# http://localhost:3000/resident.html (Resident)
# http://localhost:3000/admin.html (Admin)
```

### Railway Deployment

See **[DEPLOYMENT.md](./DEPLOYMENT.md)** for complete deployment guide.

**Key steps:**
1. Connect GitHub repo to Railway
2. Add environment variables
3. Auto-deploys on every git push

## 📁 Project Structure

```
smartparkk/
├── backend/
│   ├── server.js               # Express API + OTP handling
│   ├── package.json
│   ├── setup-db.js             # Database initialization
│   └── .env                    # Environment variables (gitignored)
│
├── frontend/
│   ├── index.html              # Visitor portal
│   ├── resident.html           # Resident portal (PWA)
│   ├── admin.html              # Admin dashboard
│   ├── manifest.json           # PWA manifest
│   ├── sw.js                   # Service Worker
│   ├── js/
│   │   ├── app.js              # Visitor logic
│   │   ├── resident.js         # Resident logic
│   │   └── admin.js            # Admin logic (1500+ lines)
│   └── css/
│       ├── styles.css          # Main styles
│       └── admin.css           # Admin dashboard styles
│
├── Dockerfile                  # Container configuration
├── .dockerignore
├── .gitignore
├── DEPLOYMENT.md               # Deployment guide
├── .env.example                # Environment template
└── README.md                   # This file
```

## 🔐 Security Features

- ✅ Phone-based OTP verification (WhatsApp)
- ✅ Session-based admin authentication (10-min timeout)
- ✅ Supabase PostgreSQL encryption
- ✅ HTTPS/TLS on Railway
- ✅ Environment variables for secrets
- ✅ XSS protection with HTML escaping
- ✅ CSRF tokens in forms

## 📋 API Endpoints

### Public Endpoints
- `POST /api/send-otp` - Send OTP to visitor phone
- `POST /api/verify-otp` - Verify OTP & create visit record
- `GET /api/visitors` - Get all visit records
- `GET /api/residents` - Get resident profiles

### Protected Endpoints (Admin & Resident)
- `POST /api/approvals` - Resident approves/denies entry
- `POST /api/gate-notifications` - Get pending requests
- `POST /api/gate-notifications/dismiss` - Mark complete
- `PUT /api/visitors/:id` - Update visit record
- `DELETE /api/blocked-visitors` - Unblock visitor

See **[DEPLOYMENT.md](./DEPLOYMENT.md#-api-endpoints)** for complete API documentation.

## 💰 Pricing Configuration

Admins can configure:
- **Hourly Rate**: Base parking charge per hour (default: ₹5)
- **Fine Amount**: Penalty for exceeding time (default: ₹50)
- **Total Capacity**: Total parking spots available (default: 50)

Changes are saved in `localStorage` and persisted across sessions.

## 📝 Recent Updates

### Latest Features
- ✅ Fixed: Repeated gate notifications after dismissal
- ✅ Added: Resident availability check at OTP stage
- ✅ Added: Time-based fine for exceeding parking duration
- ✅ Added: Fine warnings in WhatsApp messages
- ✅ Added: Admin-configurable fine amount
- ✅ Added: PWA installation support for Resident portal

### v1.0 (Initial Release)
- WhatsApp OTP verification system
- Real-time resident approval workflow
- Admin dashboard with analytics
- Exit camera with OCR plate recognition
- Charge calculation & receipt generation

## 🤝 Contributing

This is a private project. For contributions:
1. Create a feature branch
2. Make your changes
3. Test locally
4. Push and create a pull request
5. Merge after review

## 📞 Support

**For deployment issues:**
- Check Railway dashboard logs
- Verify environment variables in Railway
- Review browser console for frontend errors
- Check API responses in Network tab

**For feature requests:**
- Document the requirement clearly
- Include use case and expected behavior
- Create a test scenario

## 📄 License

This project is proprietary and confidential.

---

**Built with ❤️ for smart community management**

**Live URL**: https://smartparkk-production.up.railway.app/
