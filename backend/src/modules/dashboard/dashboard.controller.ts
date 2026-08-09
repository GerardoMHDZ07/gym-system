import { Request, Response } from "express";
import { pool } from "../../config/db";

// Dashboard de analytics — SOLO LECTURA, sin mutar la DB (a diferencia de la
// materialización perezosa de memberships, que sí persiste el estado derivado).
// Ventanas fijas (decisión del grill-me): hoy, últimos 7 y 30 días.

// Las 9 queries son agregaciones independientes: se disparan en paralelo.
// Todos los count(*) se castean a ::int y los SUM/AVG de NUMERIC a ::float8
// para que el JSON lleve números (misma convención que metrics: pg devuelve
// int8/numeric como string por defecto).
export async function summary(req: Request, res: Response) {
  const [
    membersRes,
    membershipsRes,
    checkinsRes,
    checkinsByDayRes,
    revenueRes,
    revenueByMethodRes,
    upcomingClassesRes,
    occupancyRes,
    activeBookingsRes,
  ] = await Promise.all([
    pool.query(
      `SELECT
         count(*)::int AS total,
         count(*) FILTER (WHERE created_at >= now() - interval '30 days')::int AS new_last_30d
       FROM users
       WHERE role = 'miembro'`
    ),
    // Estado vigente calculado sobre la marcha con la MISMA regla que la
    // materialización: 'activa' solo si además end_date no pasó; una 'activa'
    // vencida cuenta como vencida sin escribir en la DB.
    pool.query(
      `SELECT
         count(*) FILTER (WHERE status = 'activa' AND end_date >= CURRENT_DATE)::int AS activa,
         count(*) FILTER (WHERE status = 'cancelada')::int AS cancelada,
         count(*) FILTER (WHERE status = 'vencida' OR (status = 'activa' AND end_date < CURRENT_DATE))::int AS vencida
       FROM memberships`
    ),
    pool.query(
      `SELECT
         count(*) FILTER (WHERE checkin_time::date = CURRENT_DATE)::int AS today,
         count(*) FILTER (WHERE checkin_time::date >= CURRENT_DATE - 6)::int AS last_7d
       FROM checkins`
    ),
    // Serie completa de los últimos 7 días: generate_series llena los días sin
    // check-ins con 0 (lo que necesita un gráfico de barras).
    pool.query(
      `SELECT d::date AS date, count(c.id)::int AS count
       FROM generate_series(CURRENT_DATE - 6, CURRENT_DATE, interval '1 day') d
       LEFT JOIN checkins c ON c.checkin_time::date = d
       GROUP BY d
       ORDER BY d`
    ),
    pool.query(
      `SELECT
         COALESCE(round(SUM(amount) FILTER (WHERE payment_date::date = CURRENT_DATE), 2), 0)::float8 AS today,
         COALESCE(round(SUM(amount) FILTER (WHERE payment_date >= now() - interval '30 days'), 2), 0)::float8 AS last_30d
       FROM payments
       WHERE status = 'completado'`
    ),
    pool.query(
      `SELECT method, COALESCE(round(SUM(amount), 2), 0)::float8 AS total
       FROM payments
       WHERE status = 'completado' AND payment_date >= now() - interval '30 days'
       GROUP BY method`
    ),
    pool.query(
      `SELECT count(*)::int AS upcoming_7d
       FROM classes
       WHERE schedule_start > now() AND schedule_start <= now() + interval '7 days'`
    ),
    // Ocupación promedio (0..1) de las clases próximas a 7 días: reservas
    // vigentes sobre la capacidad, por clase, promediadas.
    pool.query(
      `SELECT COALESCE(avg(occ)::float8, 0) AS avg_occupancy
       FROM (
         SELECT count(b.id)::float8 / NULLIF(c.capacity, 0) AS occ
         FROM classes c
         LEFT JOIN class_bookings b ON b.class_id = c.id AND b.status = 'reservada'
         WHERE c.schedule_start > now() AND c.schedule_start <= now() + interval '7 days'
         GROUP BY c.id, c.capacity
       ) t`
    ),
    // Conteo global de reservas 'reservada'. Nota: incluye reservas de clases
    // ya pasadas (su fila sigue 'reservada' hasta cancelarse o marcarse
    // 'asistio' — trabajo futuro) — es el volumen de reservas vigentes en el
    // sistema, no solo de clases futuras.
    pool.query(
      `SELECT count(*)::int AS active_bookings
       FROM class_bookings
       WHERE status = 'reservada'`
    ),
  ]);

  const ms = membershipsRes.rows[0];
  const checkins = checkinsRes.rows[0];
  const revenue = revenueRes.rows[0];

  res.json({
    members: {
      total: membersRes.rows[0].total,
      new_last_30d: membersRes.rows[0].new_last_30d,
    },
    memberships: {
      active: ms.activa,
      breakdown: [
        { status: "activa", count: ms.activa },
        { status: "vencida", count: ms.vencida },
        { status: "cancelada", count: ms.cancelada },
      ],
    },
    checkins: {
      today: checkins.today,
      last_7d_total: checkins.last_7d,
      by_day_last_7d: checkinsByDayRes.rows,
    },
    revenue: {
      today: revenue.today,
      last_30d: revenue.last_30d,
      by_method_last_30d: revenueByMethodRes.rows,
    },
    classes: {
      upcoming_7d: upcomingClassesRes.rows[0].upcoming_7d,
      active_bookings: activeBookingsRes.rows[0].active_bookings,
      avg_occupancy_7d: occupancyRes.rows[0].avg_occupancy,
    },
  });
}
