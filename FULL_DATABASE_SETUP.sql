-- SmartParkk Full Database Schema
-- Run this in your Supabase SQL Editor (https://supabase.com/dashboard/project/_/sql/new)

-- 1. Residents Table
CREATE TABLE IF NOT EXISTS residents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    flat_input TEXT UNIQUE NOT NULL,
    base_flat_id TEXT NOT NULL,
    role TEXT NOT NULL,
    phone TEXT NOT NULL,
    car_plate TEXT DEFAULT 'N/A',
    password TEXT NOT NULL,
    is_available BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Visitors Table
CREATE TABLE IF NOT EXISTS visitors (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    license_plate TEXT NOT NULL,
    visiting_flat TEXT NOT NULL,
    entry_time TIMESTAMPTZ NOT NULL,
    exit_time TIMESTAMPTZ,
    rate_per_hour DECIMAL(10,2) DEFAULT 5.00,
    total_charge DECIMAL(10,2) DEFAULT 0.00,
    estimated_hours DECIMAL(10,2) DEFAULT 4.00,
    extension_notified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Visitor Requests (for Resident approval)
CREATE TABLE IF NOT EXISTS visitor_requests (
    id TEXT PRIMARY KEY,
    visitor_name TEXT,
    visitor_phone TEXT,
    license_plate TEXT,
    visiting_flat TEXT,
    status TEXT NOT NULL DEFAULT 'pending', -- pending, approved, rejected
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    responded_at TIMESTAMPTZ
);

-- 4. Gate Notifications (for Admin dashboard)
CREATE TABLE IF NOT EXISTS gate_notifications (
    id BIGSERIAL PRIMARY KEY,
    visitor_name TEXT,
    visitor_phone TEXT,
    license_plate TEXT,
    visiting_flat TEXT,
    request_id TEXT,
    status TEXT NOT NULL DEFAULT 'pending', -- pending, opened
    type TEXT NOT NULL DEFAULT 'approved', -- approved, blocked, overstay
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    opened_at TIMESTAMPTZ
);

-- Add opened_at column if it doesn't exist (for existing installations)
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name='gate_notifications' AND column_name='opened_at') THEN
        ALTER TABLE gate_notifications ADD COLUMN opened_at TIMESTAMPTZ;
    END IF;
END $$;

-- 5. Blocked Visitors
CREATE TABLE IF NOT EXISTS blocked_visitors (
    id BIGSERIAL PRIMARY KEY,
    resident_flat_id TEXT NOT NULL,
    visitor_phone TEXT NOT NULL,
    visitor_name TEXT,
    blocked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (resident_flat_id, visitor_phone)
);

-- 6. Settings
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. Push Subscriptions
CREATE TABLE IF NOT EXISTS push_subscriptions (
    id BIGSERIAL PRIMARY KEY,
    flat_id TEXT UNIQUE NOT NULL,
    subscription JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. WhatsApp Sessions (for persistent WhatsApp sessions across deployments)
CREATE TABLE IF NOT EXISTS whatsapp_sessions (
    key TEXT PRIMARY KEY,
    session_data JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 9. Admins Table
CREATE TABLE IF NOT EXISTS admins (
    id BIGSERIAL PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Initial Settings Data
INSERT INTO settings (key, value) VALUES 
('smartpark_total_parking', '21'),
('smartpark_rate_per_hour', '5'),
('smartpark_fine_amount', '50')
ON CONFLICT (key) DO NOTHING;

-- ENABLE ROW LEVEL SECURITY (RLS)
-- Note: These policies allow anonymous access for demo/simplicity.
-- In a real production app, you should use proper authentication.

ALTER TABLE residents ENABLE ROW LEVEL SECURITY;
ALTER TABLE visitors ENABLE ROW LEVEL SECURITY;
ALTER TABLE visitor_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE gate_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE blocked_visitors ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE admins ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all for anon" ON residents FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for anon" ON visitors FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for anon" ON visitor_requests FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for anon" ON gate_notifications FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for anon" ON blocked_visitors FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for anon" ON settings FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for anon" ON push_subscriptions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for anon" ON whatsapp_sessions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for anon" ON admins FOR ALL USING (true) WITH CHECK (true);
