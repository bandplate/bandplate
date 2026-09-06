import { uuidv7 } from "@bandlib/core";
import { eq } from "drizzle-orm";
import type { Db } from "../client.js";
import { members } from "../schema/sqlite/index.js";

export type MemberRole = (typeof members.$inferSelect)["role"];
export type MemberStatus = (typeof members.$inferSelect)["status"];
export type Member = typeof members.$inferSelect;

export interface CreateMemberInput {
  displayName: string;
  slug: string;
  email: string;
  role?: MemberRole;
  status?: MemberStatus;
  createdAt: number;
}

/** Normalize an email the same way it is stored: lowercased and trimmed. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function create(db: Db, input: CreateMemberInput): Promise<Member> {
  const [row] = await db
    .insert(members)
    .values({
      id: uuidv7(),
      displayName: input.displayName,
      slug: input.slug,
      email: normalizeEmail(input.email),
      role: input.role ?? "member",
      status: input.status ?? "invited",
      createdAt: input.createdAt,
    })
    .returning();

  if (!row) {
    throw new Error("insert into members returned no row");
  }
  return row;
}

export async function getByEmail(db: Db, email: string): Promise<Member | undefined> {
  const [row] = await db
    .select()
    .from(members)
    .where(eq(members.email, normalizeEmail(email)))
    .limit(1);
  return row;
}

export async function getById(db: Db, id: string): Promise<Member | undefined> {
  const [row] = await db.select().from(members).where(eq(members.id, id)).limit(1);
  return row;
}

export async function list(db: Db): Promise<Member[]> {
  return db.select().from(members);
}

export async function setStatus(db: Db, id: string, status: MemberStatus): Promise<void> {
  await db.update(members).set({ status }).where(eq(members.id, id));
}
