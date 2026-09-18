-- More than one person can be told when a logistics customer files a shipment. Plain addresses,
-- because the people who want this often have no platform login: a shared operations mailbox, a
-- forwarding alias, a colleague at the other company.
ALTER TABLE "platform_settings"
  ADD COLUMN "logistics_alert_emails" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
