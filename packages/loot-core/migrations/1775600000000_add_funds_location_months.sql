CREATE TABLE IF NOT EXISTS funds_location_months
  (id TEXT PRIMARY KEY,
   has_snapshot INTEGER DEFAULT 1,
   tombstone INTEGER DEFAULT 0);
