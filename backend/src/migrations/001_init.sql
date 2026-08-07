-- Gym System — esquema inicial

CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(160) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('admin','recepcion','entrenador','miembro')),
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE membership_plans (
  id SERIAL PRIMARY KEY,
  name VARCHAR(80) NOT NULL,
  duration_days INT NOT NULL,
  price NUMERIC(10,2) NOT NULL,
  description TEXT
);

CREATE TABLE memberships (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id INT NOT NULL REFERENCES membership_plans(id),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'activa' CHECK (status IN ('activa','vencida','cancelada')),
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE payments (
  id SERIAL PRIMARY KEY,
  membership_id INT NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
  amount NUMERIC(10,2) NOT NULL,
  payment_date TIMESTAMP NOT NULL DEFAULT now(),
  method VARCHAR(30) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'completado'
);

CREATE TABLE checkins (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  checkin_time TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE classes (
  id SERIAL PRIMARY KEY,
  name VARCHAR(80) NOT NULL,
  trainer_id INT NOT NULL REFERENCES users(id),
  schedule_start TIMESTAMP NOT NULL,
  schedule_end TIMESTAMP NOT NULL,
  capacity INT NOT NULL
);

CREATE TABLE class_bookings (
  id SERIAL PRIMARY KEY,
  class_id INT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL DEFAULT 'reservada' CHECK (status IN ('reservada','cancelada','asistio')),
  booked_at TIMESTAMP NOT NULL DEFAULT now(),
  UNIQUE (class_id, user_id)
);

CREATE TABLE exercises (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  muscle_group VARCHAR(50),
  description TEXT,
  video_url VARCHAR(255)
);

CREATE TABLE routines (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  created_by INT NOT NULL REFERENCES users(id),
  assigned_to INT NOT NULL REFERENCES users(id),
  notes TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE routine_exercises (
  id SERIAL PRIMARY KEY,
  routine_id INT NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
  exercise_id INT NOT NULL REFERENCES exercises(id),
  sets INT NOT NULL,
  reps INT NOT NULL,
  order_index INT NOT NULL DEFAULT 0,
  rest_seconds INT
);

CREATE TABLE body_metrics (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  weight_kg NUMERIC(5,2),
  body_fat_pct NUMERIC(4,2),
  notes TEXT
);

-- Índices para las consultas más frecuentes
CREATE INDEX idx_memberships_user ON memberships(user_id);
CREATE INDEX idx_checkins_user_time ON checkins(user_id, checkin_time);
CREATE INDEX idx_class_bookings_class ON class_bookings(class_id);
CREATE INDEX idx_body_metrics_user_date ON body_metrics(user_id, date);
