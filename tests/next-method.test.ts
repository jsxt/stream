import assert from "node:assert/strict";
import test from "node:test";
import type { StreamController } from "../Stream.js";
import Stream from "../Stream.js";
import deferred from "./_helpers/deferred.js";
import isResolved from "./_helpers/isResolved.js";

await test("next resolves with values that have already been enqueued", async (t) => {
    const s = new Stream((stream) => {
        stream.yield(10);
        stream.yield(20);
    });
    assert.deepEqual({ done: false, value: 10 }, await s.next());
    assert.deepEqual({ done: false, value: 20 }, await s.next());
});

await test("next resolves with values that haven't been received yet", async (t) => {
    let streamController!: StreamController<number>;
    const s = new Stream<number>((stream) => {
        streamController = stream;
    });

    const one = s.next();
    const two = s.next();
    // Let a microtask happen
    await Promise.resolve();
    streamController.yield(11);
    streamController.yield(23);

    assert.deepEqual({ done: false, value: 11 }, await one);
    assert.deepEqual({ done: false, value: 23 }, await two);
});

await test("next method receives done values and only done: true after that", async (t) => {
    const s = new Stream<number, number>((stream) => {
        stream.yield(111);
        stream.return(37);
        stream.yield(12);
        stream.throw("Whoopsie");
    });
    assert.deepEqual({ done: false, value: 111 }, await s.next());
    assert.deepEqual({ done: true, value: 37 }, await s.next());
    assert.deepEqual({ done: true, value: 37 }, await s.next());
    assert.deepEqual({ done: true, value: 37 }, await s.next());
});

await test("next method receives done values that haven't been received yet", async (t) => {
    let streamController!: StreamController<number, number>;
    const s = new Stream<number, number>((stream) => {
        streamController = stream;
    });

    const one = s.next();
    const two = s.next();
    const three = s.next();
    const four = s.next();
    // Let a microtask happen
    await Promise.resolve();
    streamController.yield(11);
    streamController.return(23);
    streamController.yield(12);
    streamController.throw("Whoopsies");

    assert.deepEqual({ done: false, value: 11 }, await one);
    assert.deepEqual({ done: true, value: 23 }, await two);
    assert.deepEqual({ done: true, value: 23 }, await three);
    assert.deepEqual({ done: true, value: 23 }, await four);
});

await test("next method receives exceptions as rejections", async (t) => {
    const firstError = new Error(`first error`);
    const s = new Stream<number, string>((stream) => {
        stream.yield(11);
        stream.throw(firstError);
        stream.yield(23);
        stream.throw(new Error(`second error`));
        stream.return("This shouldn't be observed");
    });

    assert.deepEqual({ done: false, value: 11 }, await s.next());
    await assert.rejects(
        () => s.next(),
        (err) => err === firstError,
    );
    await assert.rejects(
        () => s.next(),
        (err) => err === firstError,
    );
});

await test("next method receives exceptions as rejections that haven't been received yet", async (t) => {
    let streamController!: StreamController<number, Error>;
    const s = new Stream<number, Error>((stream) => {
        streamController = stream;
    });

    const one = s.next();
    const two = s.next();
    const three = s.next();

    const firstError = new Error(`first error`);
    streamController.yield(11);
    streamController.throw(firstError);
    streamController.yield(23);
    streamController.throw(new Error("second error"));
    streamController.return(new Error("This shouldn't be observed"));

    assert.deepEqual({ done: false, value: 11 }, await one);
    await assert.rejects(
        () => two,
        (err) => err === firstError,
    );
    await assert.rejects(
        () => three,
        (err) => err === firstError,
    );
});

// --- State checks

await test("next method in empty or waiting state waits until a value is emitted", async (t) => {
    let streamController!: StreamController<number>;
    const s = new Stream<number>((stream) => {
        streamController = stream;
    });

    const one = s.next();
    const two = s.next();
    // Check that it isn't already resolved
    assert(
        !(await isResolved(one)),
        "One should not yet be resolved",
    );
    assert(
        !(await isResolved(two)),
        "Two should not yet be resolved",
    );

    streamController.yield(3);
    assert.deepEqual(await one, { done: false, value: 3 });
    // Check that two still isn't resolved
    assert(
        !(await isResolved(two)),
        "Two should not yet be resolved",
    );
    streamController.yield(4);
    assert.deepEqual(await two, { done: false, value: 4 });
});

await test("next method in endWaiting state still waits until stream is complete is emitted", async (t) => {
    let streamController!: StreamController<number>;
    const s = new Stream((stream) => {
        streamController = stream;
    });

    const one = s.next();
    const two = s.next();
    const end = s.return();
    const postEnd = s.next();

    assert(
        !(await isResolved(one)),
        "One should not yet be resolved",
    );
    assert(
        !(await isResolved(two)),
        "Two should not yet be resolved",
    );
    assert(
        !(await isResolved(end)),
        "End should not yet be resolved",
    );
    assert(
        !(await isResolved(postEnd)),
        "Post end should not yet be resolved",
    );

    streamController.yield(1);

    assert.deepEqual(await one, { done: false, value: 1 });

    assert(
        !(await isResolved(two)),
        "Two should not yet be resolved",
    );
    assert(
        !(await isResolved(end)),
        "End should not yet be resolved",
    );
    assert(
        !(await isResolved(postEnd)),
        "Post end should not yet be resolved",
    );

    streamController.yield(2);

    assert.deepEqual(await two, { done: false, value: 2 });
    assert.deepEqual(await end, { done: true, value: undefined });
    assert.deepEqual(await postEnd, { done: true, value: undefined });
});

await test("next method in queued state immediately resolves with the value", async (t) => {
    let streamController!: StreamController<number>;
    const s = new Stream((stream) => {
        streamController = stream;
    });

    streamController.yield(1);
    streamController.yield(2);

    const one = s.next();
    const two = s.next();
    const three = s.next();

    assert.deepEqual(await one, { done: false, value: 1 });
    assert.deepEqual(await two, { done: false, value: 2 });

    assert(
        !(await isResolved(three)),
        "Three should not yet be resolved",
    );

    streamController.yield(3);

    assert.deepEqual(await three, { done: false, value: 3 });
});

await test("next method in endQueued state resolves with the next value", async (t) => {
    let streamController!: StreamController<number, string>;
    const s = new Stream<number, string>((stream) => {
        streamController = stream;
    });

    streamController.yield(1);
    streamController.yield(2);
    streamController.return("End");

    const one = s.next();
    const two = s.next();

    assert.deepEqual(await one, { done: false, value: 1 });
    assert.deepEqual(await two, { done: false, value: 2 });
});

await test("next method in endNext state returns { done: true } if returned", async (t) => {
    {
        let streamController!: StreamController<number, string>;
        const s = new Stream<number, string>((stream) => {
            streamController = stream;
        });

        streamController.yield(1);
        streamController.return("End");

        assert.deepEqual(await s.next(), { done: false, value: 1 });
        assert.deepEqual(await s.next(), {
            done: true,
            value: "End",
        });
    }

    {
        let streamController!: StreamController<number, string>;
        const s = new Stream<number, string>((stream) => {
            streamController = stream;
        });

        streamController.yield(1);
        streamController.return("End");

        const one = s.next();
        const end = s.next();

        assert.deepEqual(await one, { done: false, value: 1 });
        assert.deepEqual(await end, { done: true, value: "End" });
    }
});

await test("next method in endNext throws error if error thrown", async (t) => {
    {
        let streamController!: StreamController<number>;
        const s = new Stream((stream) => {
            streamController = stream;
        });

        streamController.yield(1);
        const thrownError = new Error("Oops!");
        streamController.throw(thrownError);

        assert.deepEqual(await s.next(), { done: false, value: 1 });
        await assert.rejects(
            () => s.next(),
            (err) => err === thrownError,
        );
    }

    {
        let streamController!: StreamController<number>;
        const s = new Stream((stream) => {
            streamController = stream;
        });

        streamController.yield(1);
        const thrownError = new Error("Oops!");
        streamController.throw(thrownError);

        const one = s.next();
        const error = s.next();

        assert.deepEqual(await one, { done: false, value: 1 });
        await assert.rejects(
            () => error,
            (err) => err === thrownError,
        );
    }
});

await test("next method in endNext waits until cleanup is complete", async (t) => {
    const cleanedUp = deferred();
    let streamController!: StreamController<number, string>;
    const s = new Stream<number, string>((stream) => {
        streamController = stream;
        return () => cleanedUp.promise;
    });

    streamController.return("end");
    const finished = s.next();
    assert(
        !(await isResolved(finished)),
        "Should not be resolved yet",
    );
    cleanedUp.resolve();
    assert.deepEqual(await finished, { done: true, value: "end" });
});

await test("next method in cleanupPending waits until cleanup is complete", async (t) => {
    const cleanedUp = deferred();

    let streamController!: StreamController<never, string>;
    const s = new Stream<never, string>((stream) => {
        streamController = stream;
        return () => cleanedUp.promise;
    });

    streamController.return("end");
    const finished = s.next();
    const postFinish = s.next();
    assert(
        !(await isResolved(finished)),
        "End should not be resolved yet",
    );
    assert(
        !(await isResolved(postFinish)),
        "Post finish should not be resolved yet either",
    );

    cleanedUp.resolve();

    assert.deepEqual(await finished, { done: true, value: "end" });
    assert.deepEqual(await postFinish, { done: true, value: "end" });
});

await test("next method in complete state immediately resolves", async (t) => {
    let streamController!: StreamController<never, string>;
    const s = new Stream<never, string>((stream) => {
        streamController = stream;
    });

    streamController.return("end");

    await s.next();

    assert.deepEqual(await s.next(), { done: true, value: "end" });
});
