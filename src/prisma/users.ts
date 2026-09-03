import { db } from "./db.ts";
import { seed } from "./seed.ts";

export { db };

export async function listUsers(limit = 10) {
  await seed();
  const users = await db.orm.public.User.select("id", "email").limit(limit).all();

  return users.map((user) => ({
    id: String(user.id),
    email: user.email,
  }));
}

export type StarterUser = Awaited<ReturnType<typeof listUsers>>[number];
