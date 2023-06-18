import assert from "node:assert/strict";
import test from "node:test";
import type { StreamController } from "../Stream.js";
import Stream from "../Stream.js";

await test("cleanup is called on ending a sequence early", async (t) => {
    let cleanedUp = false;
    const stream = new Stream((stream) => {
        stream.next(10);
        return () => {
            cleanedUp = true;
        };
    });

    assert.deepEqual({ done: false, value: 10 }, await stream.next());
    await stream.return();
    assert(cleanedUp);
});

await test("cleanup doesn't happen early if we're still waiting", async (t) => {
    let cleanedUp = false;
    let streamController!: StreamController<number, string>;
    const stream = new Stream<number, string>((stream) => {
        streamController = stream;
        return () => {
            cleanedUp = true;
        };
    });
    const item = stream.next();
    const item2 = stream.next();
    const closed = stream.return("test");
    assert(!cleanedUp);
    streamController.yield(3);
    streamController.yield(4);
    const value = await item;
    assert.deepEqual({ done: false, value: 3 }, value);
    const value2 = await item2;
    assert.deepEqual({ done: false, value: 4 }, value2);
    assert.deepEqual({ done: true, value: "test" }, await closed);
    assert(cleanedUp);
});

await test("cleanup is called on normal completion of a sequence", async (t) => {
    let cleanedUp = false;
    const stream = new Stream<never, number>((stream) => {
        stream.return(12);
        return () => {
            cleanedUp = true;
        };
    });
    assert.deepEqual({ done: true, value: 12 }, await stream.next());
    assert(cleanedUp);
});
