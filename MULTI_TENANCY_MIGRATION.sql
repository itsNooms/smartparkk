-- Migration to add multi-tenancy (admin isolation)
-- Run this in your Supabase SQL Editor

-- 1. Create a default admin if none exists (to assign existing data)
INSERT INTO admins (username, password)
SELECT 'admin', 'Admin@123'
WHERE NOT EXISTS (SELECT 1 FROM admins WHERE username = 'admin');

-- Get the ID of the default admin
DO $$
DECLARE
    default_admin_id BIGINT;
BEGIN
    SELECT id INTO default_admin_id FROM admins WHERE username = 'admin' LIMIT 1;

    -- 2. Add admin_id column to all relevant tables

    -- residents
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='residents' AND column_name='admin_id') THEN
        ALTER TABLE residents ADD COLUMN admin_id BIGINT REFERENCES admins(id);
        UPDATE residents SET admin_id = default_admin_id WHERE admin_id IS NULL;
        ALTER TABLE residents ALTER COLUMN admin_id SET NOT NULL;
        
        -- Update unique constraint for residents (flat_input must be unique PER admin)
        ALTER TABLE residents DROP CONSTRAINT IF EXISTS residents_flat_input_key;
        ALTER TABLE residents ADD CONSTRAINT residents_admin_flat_unique UNIQUE (admin_id, flat_input);
    END IF;

    -- visitors
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='visitors' AND column_name='admin_id') THEN
        ALTER TABLE visitors ADD COLUMN admin_id BIGINT REFERENCES admins(id);
        UPDATE visitors SET admin_id = default_admin_id WHERE admin_id IS NULL;
        ALTER TABLE visitors ALTER COLUMN admin_id SET NOT NULL;
    END IF;

    -- visitor_requests
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='visitor_requests' AND column_name='admin_id') THEN
        ALTER TABLE visitor_requests ADD COLUMN admin_id BIGINT REFERENCES admins(id);
        UPDATE visitor_requests SET admin_id = default_admin_id WHERE admin_id IS NULL;
        ALTER TABLE visitor_requests ALTER COLUMN admin_id SET NOT NULL;
    END IF;

    -- gate_notifications
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='gate_notifications' AND column_name='admin_id') THEN
        ALTER TABLE gate_notifications ADD COLUMN admin_id BIGINT REFERENCES admins(id);
        UPDATE gate_notifications SET admin_id = default_admin_id WHERE admin_id IS NULL;
        ALTER TABLE gate_notifications ALTER COLUMN admin_id SET NOT NULL;
    END IF;

    -- blocked_visitors
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='blocked_visitors' AND column_name='admin_id') THEN
        ALTER TABLE blocked_visitors ADD COLUMN admin_id BIGINT REFERENCES admins(id);
        UPDATE blocked_visitors SET admin_id = default_admin_id WHERE admin_id IS NULL;
        ALTER TABLE blocked_visitors ALTER COLUMN admin_id SET NOT NULL;
        
        -- Update unique constraint
        ALTER TABLE blocked_visitors DROP CONSTRAINT IF EXISTS blocked_visitors_resident_flat_id_visitor_phone_key;
        ALTER TABLE blocked_visitors ADD CONSTRAINT blocked_visitors_admin_flat_phone_unique UNIQUE (admin_id, resident_flat_id, visitor_phone);
    END IF;

    -- settings
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='settings' AND column_name='admin_id') THEN
        ALTER TABLE settings ADD COLUMN admin_id BIGINT REFERENCES admins(id);
        UPDATE settings SET admin_id = default_admin_id WHERE admin_id IS NULL;
        ALTER TABLE settings ALTER COLUMN admin_id SET NOT NULL;
        
        -- Update primary key for settings
        ALTER TABLE settings DROP CONSTRAINT settings_pkey;
        ALTER TABLE settings ADD PRIMARY KEY (admin_id, key);
    END IF;

    -- push_subscriptions
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='push_subscriptions' AND column_name='admin_id') THEN
        ALTER TABLE push_subscriptions ADD COLUMN admin_id BIGINT REFERENCES admins(id);
        UPDATE push_subscriptions SET admin_id = default_admin_id WHERE admin_id IS NULL;
        ALTER TABLE push_subscriptions ALTER COLUMN admin_id SET NOT NULL;
        
        -- Update unique constraint
        ALTER TABLE push_subscriptions DROP CONSTRAINT IF EXISTS push_subscriptions_flat_id_key;
        ALTER TABLE push_subscriptions ADD CONSTRAINT push_subscriptions_admin_flat_unique UNIQUE (admin_id, flat_id);
    END IF;

    -- whatsapp_sessions
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='whatsapp_sessions' AND column_name='admin_id') THEN
        ALTER TABLE whatsapp_sessions ADD COLUMN admin_id BIGINT REFERENCES admins(id);
        UPDATE whatsapp_sessions SET admin_id = default_admin_id WHERE admin_id IS NULL;
        ALTER TABLE whatsapp_sessions ALTER COLUMN admin_id SET NOT NULL;
        
        -- Update primary key
        ALTER TABLE whatsapp_sessions DROP CONSTRAINT whatsapp_sessions_pkey;
        ALTER TABLE whatsapp_sessions ADD PRIMARY KEY (admin_id, key);
    END IF;

END $$;
