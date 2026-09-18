import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../client.js";
import { createTestDb } from "../testing/create-test-db.js";
import * as members from "./members.js";
import * as pushSubscriptions from "./push-subscriptions.js";

describe("pushSubscriptionsRepo", () => {
  let db: Db;

  beforeEach(async () => {
    db = await createTestDb();
  });

  async function createMember(slug: string) {
    return members.create(db, {
      displayName: slug,
      slug,
      email: `${slug}@example.com`,
      createdAt: Date.now(),
    });
  }

  it("upsert creates a subscription, countForMember reflects it", async () => {
    const member = await createMember("push-1");

    await pushSubscriptions.upsert(
      db,
      {
        memberId: member.id,
        endpoint: "https://push.example.com/a",
        p256dh: "p256dh-a",
        auth: "auth-a",
        vapidKeyId: "key1",
      },
      1000,
    );

    expect(await pushSubscriptions.countForMember(db, member.id)).toBe(1);
  });

  it("upsert on the same endpoint reassigns member_id instead of duplicating", async () => {
    const memberA = await createMember("push-2a");
    const memberB = await createMember("push-2b");

    await pushSubscriptions.upsert(
      db,
      {
        memberId: memberA.id,
        endpoint: "https://push.example.com/shared",
        p256dh: "p256dh",
        auth: "auth",
        vapidKeyId: "key1",
      },
      1000,
    );
    await pushSubscriptions.upsert(
      db,
      {
        memberId: memberB.id,
        endpoint: "https://push.example.com/shared",
        p256dh: "p256dh-2",
        auth: "auth-2",
        vapidKeyId: "key2",
      },
      2000,
    );

    expect(await pushSubscriptions.countForMember(db, memberA.id)).toBe(0);
    expect(await pushSubscriptions.countForMember(db, memberB.id)).toBe(1);
  });

  it("removeByEndpoint removes only that member's subscription for that endpoint", async () => {
    const member = await createMember("push-3");
    await pushSubscriptions.upsert(
      db,
      {
        memberId: member.id,
        endpoint: "https://push.example.com/b",
        p256dh: "p256dh",
        auth: "auth",
        vapidKeyId: "key1",
      },
      1000,
    );

    await pushSubscriptions.removeByEndpoint(db, member.id, "https://push.example.com/b");

    expect(await pushSubscriptions.countForMember(db, member.id)).toBe(0);
  });

  it("removeById removes a subscription by its id", async () => {
    const member = await createMember("push-4");
    await pushSubscriptions.upsert(
      db,
      {
        memberId: member.id,
        endpoint: "https://push.example.com/c",
        p256dh: "p256dh",
        auth: "auth",
        vapidKeyId: "key1",
      },
      1000,
    );
    const rows = await pushSubscriptions.listForMembers(db, [member.id]);
    expect(rows).toHaveLength(1);
    const id = rows[0]?.id;
    if (!id) throw new Error("expected a subscription id");

    await pushSubscriptions.removeById(db, id);

    expect(await pushSubscriptions.countForMember(db, member.id)).toBe(0);
  });

  it("listForMembers returns subscriptions for every requested member, chunked over 90 ids", async () => {
    const memberIds: string[] = [];
    for (let i = 0; i < 150; i++) {
      const member = await createMember(`push-many-${i}`);
      memberIds.push(member.id);
      await pushSubscriptions.upsert(
        db,
        {
          memberId: member.id,
          endpoint: `https://push.example.com/many/${i}`,
          p256dh: "p256dh",
          auth: "auth",
          vapidKeyId: "key1",
        },
        1000,
      );
    }

    const rows = await pushSubscriptions.listForMembers(db, memberIds);
    expect(rows).toHaveLength(150);
  });

  it("listForMembers returns an empty array for an empty member list", async () => {
    expect(await pushSubscriptions.listForMembers(db, [])).toEqual([]);
  });

  it("markSuccess sets last_success_at", async () => {
    const member = await createMember("push-5");
    await pushSubscriptions.upsert(
      db,
      {
        memberId: member.id,
        endpoint: "https://push.example.com/d",
        p256dh: "p256dh",
        auth: "auth",
        vapidKeyId: "key1",
      },
      1000,
    );
    const [row] = await pushSubscriptions.listForMembers(db, [member.id]);
    if (!row) throw new Error("expected a subscription row");
    expect(row.lastSuccessAt).toBeNull();

    await pushSubscriptions.markSuccess(db, row.id, 5000);

    const [updated] = await pushSubscriptions.listForMembers(db, [member.id]);
    expect(updated?.lastSuccessAt).toBe(5000);
  });
});
