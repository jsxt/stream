import assert from "node:assert/strict";
import test from "node:test";
import type { StreamController } from "../Stream.js";
import Stream from "../Stream.js";

await test("we can construct a stream with an AbortSignal", (t) => {
    const abortController = new AbortController();
    {
        const stream = new Stream(
            (controller) => {
                controller.yield(1);
                controller.yield(2);
            },
            { abortSignal: abortController.signal },
        );
        assert.equal(stream.constructor, Stream);
    }
    {
        const stream = Stream.abortable(
            abortController.signal,
            (controller) => {
                controller.yield(1);
                controller.yield(2);
            },
            { abortSignal: abortController.signal },
        );
        assert.equal(stream.constructor, Stream);
    }
});

class TestError extends Error {
    override readonly name = "TestError";
}

await test("aborted stream will throw when trying to use next or return", async (t) => {
    const abortController = new AbortController();
    const stream = Stream.abortable<number>(
        abortController.signal,
        (controller) => {
            controller.yield(1);
            controller.yield(2);
        },
    );
    assert.deepEqual(await stream.next(), { done: false, value: 1 });
    assert.deepEqual(await stream.next(), { done: false, value: 2 });
    const abortError = new TestError();
    abortController.abort(abortError);
    await assert.rejects(
        () => stream.next(),
        (error) => error === abortError,
    );
});

await test("aborting a stream aborts all unresolved calls to .next and .return", async (t) => {
    const abortController = new AbortController();
    let streamController!: StreamController<number, string>;
    const stream = Stream.abortable<number, string>(
        abortController.signal,
        (s) => {
            streamController = s;
        },
    );

    const one = stream.next();
    const two = stream.next();
    const three = stream.return("foo");
    const four = stream.next();
    const five = stream.return("bar");
    streamController.yield(1);
    const abortError = new TestError();
    abortController.abort(abortError);
    assert.deepEqual(await one, { done: false, value: 1 });

    await assert.rejects(
        () => two,
        (err) => err === abortError,
    );
    await assert.rejects(
        () => three,
        (err) => err === abortError,
    );
    await assert.rejects(
        () => four,
        (err) => err === abortError,
    );
    await assert.rejects(
        () => five,
        (err) => err === abortError,
    );
});

await test("completed streams may still be aborted", async (t) => {
    const abortController = new AbortController();
    let streamController!: StreamController<number, string>;
    const stream = Stream.abortable<number, string>(
        abortController.signal,
        (s) => {
            streamController = s;
        },
    );

    streamController.yield(1);
    streamController.yield(2);
    streamController.return("done");
    assert.deepEqual(await stream.next(), { done: false, value: 1 });
    assert.deepEqual(await stream.next(), { done: false, value: 2 });
    assert.deepEqual(await stream.next(), {
        done: true,
        value: "done",
    });
    const abortError = new TestError();
    abortController.abort(abortError);

    await assert.rejects(
        () => stream.next(),
        (err) => err === abortError,
    );
    await assert.rejects(
        () => stream.return("foo"),
        (err) => err === abortError,
    );
});

await test("abort triggers cleanup", async (t) => {
    const abortController = new AbortController();
    let cleanedUp = false;
    const stream = Stream.abortable(abortController.signal, () => {
        return () => {
            cleanedUp = true;
        };
    });

    const abortError = new TestError();
    abortController.abort(abortError);
    assert.equal(cleanedUp, true);
    await assert.rejects(
        () => stream.next(),
        (err) => err === abortError,
    );
});

await test("an already aborted signal means the initializer will never run", async (t) => {
    const abortController = new AbortController();
    const abortError = new TestError();
    abortController.abort(abortError);
    let called: boolean = false;
    const stream = Stream.abortable<number>(
        abortController.signal,
        (s) => {
            called = true;
            s.yield(1);
        },
    );
    assert(!called);
    await assert.rejects(
        () => stream.next(),
        (err) => err === abortError,
    );
});
