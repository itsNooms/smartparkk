# SmartParkk Deployment Guide

## 🚀 Live Deployment

SmartParkk is successfully deployed on **Railway.app** and running 24/7!

**Live URLs:**
- **Visitor Portal**: https://smartparkk-production.up.railway.app/
- **Resident Portal**: https://smartparkk-production.up.railway.app/resident.html
- **Admin Dashboard**: https://smartparkk-production.up.railway.app/admin.html
- **API Base**: https://smartparkk-production.up.railway.app/api

## 📋 Deployment Architecture

```
GitHub Repository (itsNooms/smartparkk)
         ↓
Railway.app (Auto-deploys on push)
         ↓
Docker Container (Node.js 20 with Chromium)
         ↓
Supabase PostgreSQL Database
         ↓
WhatsApp Web.js (OTP delivery)
```

## 🔧 Environment Variables on Railway

The following variables are configured in Railway:

| Variable | Purpose |
|----------|---------|
| `PORT` | Server port (3000) |
| `SUPABASE_URL` | PostgreSQL database URL |
| `SUPABASE_ANON_KEY` | Supabase API authentication |
| `VAPID_PUBLIC_KEY` | Web Push notifications (public) |
| `VAPID_PRIVATE_KEY` | Web Push notifications (private) |

## 📤 How to Deploy Updates

1. Make changes in the code
2. Commit and push to GitHub:
   ```bash
   git add .
   git commit -m "Feature: description of changes"
   git push origin main
   ```
3. Railway automatically detects the push
4. Docker image rebuilds and redeploys automatically
5. New version live within 2-3 minutes

**No manual restarts needed!** Railway handles everything.

## 🏗️ Project Structure

```
smartparkk/
├── backend/
│   ├── server.js           # Express API server
│   ├── package.json        # Node dependencies
│   ├── setup-db.js         # Database initialization
│   ├── setup-push.js       # Push notifications setup
│   └── .env                # Environment variables (gitignored)
├── frontend/
│   ├── index.html          # Visitor portal
│   ├── resident.html       # Resident portal (with PWA)
│   ├── admin.html          # Admin dashboard
│   ├── js/
│   │   ├── app.js          # Visitor portal logic
│   │   ├── resident.js     # Resident portal logic
│   │   └── admin.js        # Admin dashboard logic
│   ├── css/
│   │   ├── styles.css      # Main styles
│   │   └── admin.css       # Admin dashboard styles
│   ├── sw.js               # Service Worker (PWA)
│   └── manifest.json       # PWA manifest
├── Dockerfile              # Container configuration
├── .dockerignore           # Files to exclude from container
├── .gitignore              # Files to exclude from GitHub
└── README.md               # Project documentation
```

## 🔐 Security Notes

- `.env` file is **never** committed (see `.gitignore`)
- Secrets are only stored in Railway's environment variables
- Use `.env.example` as a template for local development
- Railway provides automatic HTTPS for the domain

## 🛠️ Local Development

### Prerequisites
- Node.js 20+
- npm
- Chromium (for WhatsApp Web.js)

### Setup
```bash
# Install dependencies
cd backend
npm install

# Create .env file from template
cp ../.env.example .env
# Fill in your Supabase and VAPID keys

# Run backend
node server.js

# In another terminal, open frontend in browser
# http://localhost:3000
```

## 📊 Available Features

### Visitor Portal
- ✅ Register with phone OTP verification
- ✅ Select estimated parking duration
- ✅ View available parking spots
- ✅ Get real-time parking charges
- ✅ Exit confirmation with receipt
- ✅ Fine calculation for exceeding time

### Resident Portal
- ✅ Approve/deny visitor entry requests
- ✅ Block persistent visitors
- ✅ Mark availability status
- ✅ Install as mobile app (PWA)

### Admin Dashboard
- ✅ Real-time visitor tracking
- ✅ Gate access control
- ✅ Exit camera with plate OCR
- ✅ Configure parking rates & fines
- ✅ Resident and visitor management
- ✅ Blocked visitors list
- ✅ Revenue tracking

## 🔗 API Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/send-otp` | Send OTP to visitor |
| POST | `/api/verify-otp` | Verify OTP code |
| GET | `/api/visitors` | Get all visitors |
| POST | `/api/visitors/update` | Mark visitor exit |
| GET | `/api/residents` | Get resident data |
| POST | `/api/resident-otp` | Send OTP to resident |
| POST | `/api/verify-resident-otp` | Verify resident OTP |
| POST | `/api/approvals` | Create gate approval |
| POST | `/api/gate-notifications` | Get pending gate requests |
| POST | `/api/gate-notifications/dismiss` | Mark notification as handled |

## 📞 Deployment Support

For issues or questions:
1. Check Railway dashboard logs (Deployments → View logs)
2. Check browser console for frontend errors
3. Verify environment variables are correctly set in Railway
4. Ensure Supabase database is accessible

## 🎯 Next Steps

- Monitor deployment in Railway dashboard
- Test all three portals from mobile devices
- Configure custom domain if needed
- Set up monitoring and alerting
