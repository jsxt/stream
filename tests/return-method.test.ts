import assert from "node:assert/strict";
import test from "node:test";
import type { StreamController } from "../Stream.js";
import Stream from "../Stream.js";
import isResolved from "./_helpers/isResolved.js";

await test("return prevents any more messages that haven't been requested from resolving", async (t) => {
    const s = new Stream((stream) => {
        stream.yield(10);
        stream.yield(20);
        stream.yield(30);
    });

    assert.deepEqual({ done: false, value: 10 }, await s.next());
    assert.deepEqual(
        { done: true, value: undefined },
        await s.return(),
    );
    assert.deepEqual(
        { done: true, value: undefined },
        await s.next(),
    );
});

await test("return succeeds if the stream is already closed", async (t) => {
    const s = new Stream<number, number>((stream) => {
        stream.yield(10);
        stream.return(20);
        stream.yield(30);
    });

    assert.deepEqual({ done: false, value: 10 }, await s.next());
    assert.deepEqual({ done: true, value: 20 }, await s.next());
    assert.deepEqual({ done: true, value: 20 }, await s.return(20));
});

await test("return value is unchanged from first returned value", async (t) => {
    {
        const s = new Stream<number, number>((stream) => {
            stream.yield(10);
            stream.return(20);
            stream.yield(30);
        });

        assert.deepEqual({ done: false, value: 10 }, await s.next());
        assert.deepEqual({ done: true, value: 20 }, await s.next());
        assert.deepEqual(
            { done: true, value: 20 },
            await s.return(20),
        );
        assert.deepEqual(
            { done: true, value: 20 },
            await s.return(5),
        );
    }
    {
        const s = new Stream<number, number>((stream) => {
            stream.yield(10);
        });

        assert.deepEqual({ done: false, value: 10 }, await s.next());
        assert.deepEqual(
            { done: true, value: 37 },
            await s.return(37),
        );
        assert.deepEqual(
            { done: true, value: 37 },
            await s.return(3),
        );
    }
});

await test("return throws if stream becomes errored", async (t) => {
    const thrownError = new Error(`error`);

    const s = new Stream((stream) => {
        stream.yield(10);
        stream.yield(20);
        stream.throw(thrownError);
        stream.yield(30);
    });

    assert.deepEqual({ done: false, value: 10 }, await s.next());
    await assert.rejects(
        () => s.return(),
        (err) => err === thrownError,
    );
});

await test("return continues to throw if state is complete and errored", async (t) => {
    const thrownError = new Error(`error`);
    const s = new Stream((stream) => {
        stream.yield(10);
        stream.throw(thrownError);
    });

    assert.deepEqual({ done: false, value: 10 }, await s.next());
    await assert.rejects(
        () => s.next(),
        (err) => err === thrownError,
    );
    await assert.rejects(
        () => s.return(),
        (err) => err === thrownError,
    );
});

await test("return honors previous calls to .next", async (t) => {
    let streamController!: StreamController<number>;
    const s = new Stream((stream) => {
        streamController = stream;
    });
    const one = s.next();
    const two = s.next();
    const three = s.return();
    const four = s.next();

    streamController.yield(10);
    streamController.yield(20);
    streamController.yield(30);
    streamController.yield(40);

    assert.deepEqual({ done: false, value: 10 }, await one);
    assert.deepEqual({ done: false, value: 20 }, await two);
    assert.deepEqual({ done: true, value: undefined }, await three);
    assert.deepEqual({ done: true, value: undefined }, await four);
});

await test("return follows the return value if there's one in the queue", async (t) => {
    const s = new Stream<number, number>((stream) => {
        stream.yield(10);
        stream.return(12);
    });

    assert.deepEqual({ done: true, value: 12 }, await s.return(3));
});

await test("return follows the error if there's one in the queue", async (t) => {
    const thrownError = new Error("oops");
    const s = new Stream((stream) => {
        stream.yield(10);
        stream.throw(thrownError);
    });

    await assert.rejects(
        () => s.return(),
        (err) => err === thrownError,
    );
});

await test("return method in empty or queued state resolves immediately", async (t) => {
    {
        const s = new Stream(() => {
            /* Nothing to do */
        });

        assert.deepEqual(await s.return(), {
            done: true,
            value: undefined,
        });
    }

    // Gives back correct return value
    {
        const s = new Stream<number, number>(() => {
            /* Nothing to do */
        });

        assert.deepEqual(await s.return(12), {
            done: true,
            value: 12,
        });
    }

    {
        let streamController!: StreamController<number>;
        const s = new Stream((stream) => {
            streamController = stream;
        });

        streamController.yield(1);
        streamController.yield(2);

        assert.deepEqual(await s.return(), {
            done: true,
            value: undefined,
        });
    }

    {
        let streamController!: StreamController<number, number>;
        const s = new Stream<number, number>((stream) => {
            streamController = stream;
        });

        streamController.yield(1);
        streamController.yield(2);

        assert.deepEqual(await s.return(12), {
            done: true,
            value: 12,
        });
    }
});

await test("return method in waiting or endWaiting state resolves when final .next is resolved and cleaup is complete", async (t) => {
    let streamController!: StreamController<number>;
    const s = new Stream<number, void>((stream) => {
        streamController = stream;
    });

    const one = s.next();
    const two = s.next();
    const end = s.return();
    const postEnd = s.return();

    assert(!(await isResolved(one)), `one shouldn't be resolved`);
    assert(!(await isResolved(two)), `two shouldn't be resolved`);
    assert(!(await isResolved(end)), `end shouldn't be resolved`);
    assert(
        !(await isResolved(postEnd)),
        `postEnd shouldn't be resolved`,
    );

    streamController.yield(1);
    assert.deepEqual(await one, { done: false, value: 1 });

    assert(!(await isResolved(two)), `two shouldn't be resolved`);
    assert(!(await isResolved(end)), `end shouldn't be resolved`);
    assert(
        !(await isResolved(postEnd)),
        `postEnd shouldn't be resolved`,
    );

    streamController.yield(2);
    assert.deepEqual(await two, { done: false, value: 2 });

    assert.deepEqual(await end, { done: true, value: undefined });
    assert.deepEqual(await postEnd, { done: true, value: undefined });
});
