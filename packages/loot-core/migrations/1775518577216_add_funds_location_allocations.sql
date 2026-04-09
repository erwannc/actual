CREATE TABLE IF NOT EXISTS funds_location_allocations
  (id TEXT PRIMARY KEY,
   month TEXT,
   category_id TEXT,
   account_id TEXT,
   amount INTEGER,
   tombstone INTEGER DEFAULT 0,
   FOREIGN KEY(category_id) REFERENCES categories(id),
   FOREIGN KEY(account_id) REFERENCES accounts(id));

CREATE TABLE IF NOT EXISTS funds_location_months
  (id TEXT PRIMARY KEY,
   has_snapshot INTEGER DEFAULT 1,
   tombstone INTEGER DEFAULT 0);
