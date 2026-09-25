-- The 10-zone grid (plan §7.1): reference data, not demo data, so it lives
-- in a migration rather than the app seed script. Coordinates are tenths of
-- a km (dkm) so every distance is an integer; origin is Banani.
INSERT INTO "zones" ("code", "name", "x_dkm", "y_dkm") VALUES
  ('BANANI', 'Banani', 0, 0),
  ('GULSHAN_1', 'Gulshan 1', 15, -15),
  ('GULSHAN_2', 'Gulshan 2', 15, 5),
  ('MOHAKHALI', 'Mohakhali', -5, -20),
  ('TEJGAON', 'Tejgaon', 0, -35),
  ('FARMGATE', 'Farmgate', -20, -45),
  ('DHANMONDI', 'Dhanmondi', -30, -70),
  ('MIRPUR', 'Mirpur', -50, 0),
  ('UTTARA', 'Uttara', 5, 90),
  ('BASHUNDHARA', 'Bashundhara', 40, 15)
ON CONFLICT ("code") DO NOTHING;
