ALTER TABLE workouts
ADD COLUMN IF NOT EXISTS body_part TEXT;

ALTER TABLE workouts
DROP CONSTRAINT IF EXISTS workouts_body_part_check;

ALTER TABLE workouts
ADD CONSTRAINT workouts_body_part_check
CHECK (body_part IN ('chest', 'shoulder', 'arm', 'leg', 'core', 'back'));
