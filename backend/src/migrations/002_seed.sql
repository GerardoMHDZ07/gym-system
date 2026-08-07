-- Datos de prueba para demo/desarrollo local.
-- Password para todos los usuarios: demo1234

INSERT INTO users (name, email, password_hash, role) VALUES
  ('Ana Torres',      'admin@gym.local',      '$2b$10$6399AVHpG5OM1CFyJ302OeGFUXWG42YR1Mf5WKOJJpI7KBdznYx2e', 'admin'),
  ('Luis Perez',      'recepcion@gym.local',  '$2b$10$6399AVHpG5OM1CFyJ302OeGFUXWG42YR1Mf5WKOJJpI7KBdznYx2e', 'recepcion'),
  ('Carla Ruiz',      'carla@gym.local',      '$2b$10$6399AVHpG5OM1CFyJ302OeGFUXWG42YR1Mf5WKOJJpI7KBdznYx2e', 'entrenador'),
  ('Jorge Salinas',   'jorge@gym.local',      '$2b$10$6399AVHpG5OM1CFyJ302OeGFUXWG42YR1Mf5WKOJJpI7KBdznYx2e', 'entrenador'),
  ('Miguel Hernandez','miguel@gym.local',     '$2b$10$6399AVHpG5OM1CFyJ302OeGFUXWG42YR1Mf5WKOJJpI7KBdznYx2e', 'miembro'),
  ('Sofia Lopez',     'sofia@gym.local',      '$2b$10$6399AVHpG5OM1CFyJ302OeGFUXWG42YR1Mf5WKOJJpI7KBdznYx2e', 'miembro'),
  ('Daniel Cruz',     'daniel@gym.local',     '$2b$10$6399AVHpG5OM1CFyJ302OeGFUXWG42YR1Mf5WKOJJpI7KBdznYx2e', 'miembro');

INSERT INTO membership_plans (name, duration_days, price, description) VALUES
  ('Mensual',   30,  450.00,  'Acceso completo, renovacion mensual'),
  ('Trimestral',90,  1200.00, 'Acceso completo, 3 meses'),
  ('Anual',     365, 4200.00, 'Acceso completo, 1 ano, incluye 1 evaluacion fisica gratis');

-- Miguel: membresia mensual activa
INSERT INTO memberships (user_id, plan_id, start_date, end_date, status)
SELECT u.id, p.id, CURRENT_DATE - INTERVAL '10 days', CURRENT_DATE + INTERVAL '20 days', 'activa'
FROM users u, membership_plans p
WHERE u.email = 'miguel@gym.local' AND p.name = 'Mensual';

-- Sofia: membresia trimestral activa
INSERT INTO memberships (user_id, plan_id, start_date, end_date, status)
SELECT u.id, p.id, CURRENT_DATE - INTERVAL '20 days', CURRENT_DATE + INTERVAL '70 days', 'activa'
FROM users u, membership_plans p
WHERE u.email = 'sofia@gym.local' AND p.name = 'Trimestral';

-- Daniel: membresia mensual vencida (util para probar logica de vencimientos)
INSERT INTO memberships (user_id, plan_id, start_date, end_date, status)
SELECT u.id, p.id, CURRENT_DATE - INTERVAL '45 days', CURRENT_DATE - INTERVAL '15 days', 'vencida'
FROM users u, membership_plans p
WHERE u.email = 'daniel@gym.local' AND p.name = 'Mensual';

INSERT INTO payments (membership_id, amount, method, status)
SELECT m.id, p.price, 'tarjeta', 'completado'
FROM memberships m
JOIN users u ON u.id = m.user_id
JOIN membership_plans p ON p.id = m.plan_id
WHERE u.email IN ('miguel@gym.local', 'sofia@gym.local', 'daniel@gym.local');

INSERT INTO checkins (user_id, checkin_time)
SELECT u.id, CURRENT_TIMESTAMP - (n || ' days')::interval
FROM users u, generate_series(1, 5) n
WHERE u.email = 'miguel@gym.local';

INSERT INTO checkins (user_id, checkin_time)
SELECT u.id, CURRENT_TIMESTAMP - (n || ' days')::interval
FROM users u, generate_series(1, 3) n
WHERE u.email = 'sofia@gym.local';

INSERT INTO classes (name, trainer_id, schedule_start, schedule_end, capacity)
SELECT 'Spinning', u.id, CURRENT_DATE + TIME '07:00', CURRENT_DATE + TIME '08:00', 15
FROM users u WHERE u.email = 'carla@gym.local';

INSERT INTO classes (name, trainer_id, schedule_start, schedule_end, capacity)
SELECT 'Funcional', u.id, CURRENT_DATE + TIME '18:00', CURRENT_DATE + TIME '19:00', 12
FROM users u WHERE u.email = 'jorge@gym.local';

INSERT INTO classes (name, trainer_id, schedule_start, schedule_end, capacity)
SELECT 'Yoga', u.id, CURRENT_DATE + INTERVAL '1 day' + TIME '09:00', CURRENT_DATE + INTERVAL '1 day' + TIME '10:00', 20
FROM users u WHERE u.email = 'carla@gym.local';

INSERT INTO class_bookings (class_id, user_id, status)
SELECT c.id, u.id, 'reservada'
FROM classes c, users u
WHERE c.name = 'Spinning' AND u.email = 'miguel@gym.local';

INSERT INTO class_bookings (class_id, user_id, status)
SELECT c.id, u.id, 'reservada'
FROM classes c, users u
WHERE c.name = 'Yoga' AND u.email = 'sofia@gym.local';

INSERT INTO exercises (name, muscle_group, description) VALUES
  ('Sentadilla',   'piernas', 'Sentadilla con barra, enfoque en profundidad'),
  ('Press banca',  'pecho',   'Press plano con barra'),
  ('Peso muerto',  'espalda', 'Deadlift convencional'),
  ('Dominadas',    'espalda', 'Peso corporal o asistidas'),
  ('Plancha',      'core',    'Isometrico, mantener alineacion');

INSERT INTO routines (name, created_by, assigned_to, notes)
SELECT 'Fuerza - nivel principiante', c.id, m.id, 'Progresion basica, 3 sesiones por semana'
FROM users c, users m
WHERE c.email = 'carla@gym.local' AND m.email = 'miguel@gym.local';

INSERT INTO routine_exercises (routine_id, exercise_id, sets, reps, order_index, rest_seconds)
SELECT r.id, e.id, vals.sets, vals.reps, vals.order_index, 90
FROM routines r
JOIN (VALUES
  ('Sentadilla',  3, 10, 1),
  ('Press banca', 3, 10, 2),
  ('Plancha',     3, 30, 3)
) AS vals(exercise_name, sets, reps, order_index) ON true
JOIN exercises e ON e.name = vals.exercise_name
WHERE r.name = 'Fuerza - nivel principiante';

INSERT INTO body_metrics (user_id, date, weight_kg, body_fat_pct)
SELECT u.id, CURRENT_DATE - INTERVAL '30 days', 82.4, 24.5
FROM users u WHERE u.email = 'miguel@gym.local';

INSERT INTO body_metrics (user_id, date, weight_kg, body_fat_pct)
SELECT u.id, CURRENT_DATE, 80.1, 22.8
FROM users u WHERE u.email = 'miguel@gym.local';
