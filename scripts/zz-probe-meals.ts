import "/home/user/lifemaxx/load-env";
import { adminDb } from "/home/user/lifemaxx/src/db";
import { sql } from "drizzle-orm";

async function main() {
  const rows = await adminDb.execute(sql`
    select m.local_date, m.slot, m.source, m.kcal,
           (select count(*) from meal_items i where i.meal_id = m.id) as items,
           left(m.note, 90) as note
    from meals m
    order by m.local_date desc, m.eaten_at
    limit 40
  `);
  console.log("MEALS", JSON.stringify(rows.rows ?? rows, null, 1));

  const t = await adminDb.execute(sql`select * from targets order by effective_from desc limit 5`);
  console.log("TARGETS", JSON.stringify(t.rows ?? t, null, 1));

  const bm = await adminDb.execute(sql`select count(*) as n, min(measured_on) as first, max(measured_on) as last from body_metrics where weight_kg is not null`);
  console.log("WEIGHINS", JSON.stringify(bm.rows ?? bm, null, 1));

  const p = await adminDb.execute(sql`select id, created_at, left(coalesce(goals_text,''),60) as goals, tz from profiles limit 5`);
  console.log("PROFILES", JSON.stringify(p.rows ?? p, null, 1));
}
void main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
