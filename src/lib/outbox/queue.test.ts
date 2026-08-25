import { describe, it, expect } from "vitest";
import {
  flush, memoryStore, backoffMs, classifyStatus, MAX_ATTEMPTS,
  type OutboxItem, type Send,
} from "./queue";

const item = (id: string, createdAt: number, over: Partial<OutboxItem> = {}): OutboxItem => ({
  id, kind: "set", url: "/api/sets",
  payload: { reps: 5, weightLb: 185 },
  createdAt, attempts: 0, nextAttemptAt: 0, ...over,
});

const always = (result: Awaited<ReturnType<Send>>): Send => async () => result;

describe("retry classification", () => {
  it("retries what retrying can fix", () => {
    expect(classifyStatus(500)).toBe("retry");
    expect(classifyStatus(502)).toBe("retry");
    expect(classifyStatus(429)).toBe("retry");
    expect(classifyStatus(408)).toBe("retry");
  });

  it("gives up on a payload the server will never accept", () => {
    expect(classifyStatus(400)).toBe("permanent");
    expect(classifyStatus(401)).toBe("permanent");
    expect(classifyStatus(404)).toBe("permanent");
  });

  it("treats a 2xx as delivered", () => {
    expect(classifyStatus(200)).toBe("ok");
    expect(classifyStatus(201)).toBe("ok");
  });
});

describe("backoff", () => {
  it("doubles and then stops doubling", () => {
    expect(backoffMs(1)).toBe(2_000);
    expect(backoffMs(2)).toBe(4_000);
    expect(backoffMs(3)).toBe(8_000);
    expect(backoffMs(20)).toBe(60_000);
  });
});

describe("flush", () => {
  it("delivers everything when the network is there", async () => {
    const store = memoryStore([item("a", 1), item("b", 2), item("c", 3)]);
    const result = await flush(store, always({ status: "ok" }));

    expect(result.sent).toBe(3);
    expect(result.remaining).toBe(0);
    expect(await store.all()).toEqual([]);
  });

  it("delivers oldest first", async () => {
    const store = memoryStore([item("c", 3), item("a", 1), item("b", 2)]);
    const order: string[] = [];
    await flush(store, async (i) => { order.push(i.id); return { status: "ok" }; });
    expect(order).toEqual(["a", "b", "c"]);
  });

  it("stops at the first failure instead of skipping past it", async () => {
    // set_index and the measured rest gap both come from the set before, so
    // delivering set 3 while set 2 is stuck would corrupt the session.
    const store = memoryStore([item("a", 1), item("b", 2), item("c", 3)]);
    const attempted: string[] = [];

    const result = await flush(store, async (i) => {
      attempted.push(i.id);
      return i.id === "b" ? { status: "retry", error: "offline" } : { status: "ok" };
    });

    expect(attempted).toEqual(["a", "b"]);
    expect(result.sent).toBe(1);
    expect(result.blocked).toBe(true);
    expect((await store.all()).map((i) => i.id).sort()).toEqual(["b", "c"]);
  });

  it("keeps everything queued when the phone has no signal at all", async () => {
    const store = memoryStore([item("a", 1), item("b", 2)]);
    const result = await flush(store, always({ status: "retry", error: "network" }));

    expect(result.sent).toBe(0);
    expect(result.remaining).toBe(2);
    expect((await store.all())).toHaveLength(2);
  });

  it("records the attempt and schedules a backoff", async () => {
    const store = memoryStore([item("a", 1)]);
    await flush(store, always({ status: "retry", error: "offline" }), 10_000);

    const [stored] = await store.all();
    expect(stored.attempts).toBe(1);
    expect(stored.nextAttemptAt).toBe(10_000 + backoffMs(1));
    expect(stored.lastError).toBe("offline");
  });

  it("waits out a backoff rather than hammering", async () => {
    const store = memoryStore([item("a", 1, { attempts: 1, nextAttemptAt: 50_000 })]);
    let called = 0;
    const result = await flush(store, async () => { called += 1; return { status: "ok" }; }, 10_000);

    expect(called).toBe(0);
    expect(result.blocked).toBe(true);
    expect(await store.all()).toHaveLength(1);
  });

  it("sends once the backoff has elapsed", async () => {
    const store = memoryStore([item("a", 1, { attempts: 1, nextAttemptAt: 50_000 })]);
    const result = await flush(store, always({ status: "ok" }), 60_000);
    expect(result.sent).toBe(1);
  });

  it("drops a permanently-rejected item rather than wedging the queue behind it", async () => {
    const store = memoryStore([item("bad", 1), item("good", 2)]);
    const result = await flush(store, async (i) =>
      i.id === "bad" ? { status: "permanent", error: "400 unknown exercise" } : { status: "ok" });

    expect(result.dropped.map((i) => i.id)).toEqual(["bad"]);
    expect(result.sent).toBe(1);
    expect(await store.all()).toEqual([]);
  });

  it("gives up after enough failed attempts", async () => {
    const store = memoryStore([item("a", 1, { attempts: MAX_ATTEMPTS - 1 })]);
    const result = await flush(store, always({ status: "retry", error: "still offline" }));

    expect(result.dropped.map((i) => i.id)).toEqual(["a"]);
    expect(await store.all()).toEqual([]);
  });

  it("does the nothing case cleanly", async () => {
    const result = await flush(memoryStore(), always({ status: "ok" }));
    expect(result).toEqual({ sent: 0, dropped: [], remaining: 0, blocked: false });
  });

  it("resumes where it left off across flushes", async () => {
    const store = memoryStore([item("a", 1), item("b", 2), item("c", 3)]);
    let offline = true;
    const send: Send = async () => (offline ? { status: "retry", error: "offline" } : { status: "ok" });

    // In the gym, no signal.
    await flush(store, send, 0);
    expect(await store.all()).toHaveLength(3);

    // Out in the car park.
    offline = false;
    const result = await flush(store, send, 120_000);
    expect(result.sent).toBe(3);
    expect(await store.all()).toEqual([]);
  });
});
