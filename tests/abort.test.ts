import test from "ava";
import type { StreamController } from "../dist/Stream.js";
import Stream, { AbortError } from "../dist/Stream.js";

test("we can construct a stream with an AbortSignal", (t) => {
    const abortController = new AbortController();
    {
        const stream = new Stream((controller) => {
            controller.yield(1);
            controller.yield(2);
        }, { abortSignal: abortController.signal });
        t.is(stream.constructor, Stream);
    }
    {
        const stream = Stream.abortable(abortController.signal, (controller) => {
            controller.yield(1);
            controller.yield(2);
        }, { abortSignal: abortController.signal });
        t.is(stream.constructor, Stream);
    }
});

test(
    "aborted stream will throw when trying to use next or return",
    async (t) => {
        const abortController = new AbortController();
        const stream = Stream.abortable<number>(
            abortController.signal,
            (controller) => {
                controller.yield(1);
                controller.yield(2);
            },
        );
        t.deepEqual(await stream.next(), { done: false, value: 1 });
        t.deepEqual(await stream.next(), { done: false, value: 2 });
        abortController.abort();
        const error = await t.throwsAsync(() => stream.next());
        t.is(error.name, "AbortError");
        t.is(error.constructor, AbortError);
    },
);

test(
    "aborting a stream aborts all unresolved calls to .next and .return",
    async (t) => {
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
        abortController.abort();
        t.deepEqual(await one, { done: false, value: 1 });
        const error1 = await t.throwsAsync(() => two);
        t.is(error1.name, "AbortError");
        const error2 = await t.throwsAsync(() => three);
        t.is(error2.name, "AbortError");
        const error3 = await t.throwsAsync(() => four);
        t.is(error3.name, "AbortError");
        const error4 = await t.throwsAsync(() => five);
        t.is(error4.name, "AbortError");
    },
);

test(
    "completed streams may still be aborted",
    async (t) => {
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
        t.deepEqual(await stream.next(), { done: false, value: 1 });
        t.deepEqual(await stream.next(), { done: false, value: 2 });
        t.deepEqual(await stream.next(), { done: true, value: "done" });
        abortController.abort();
        const error1 = await t.throwsAsync(() => stream.next());
        const error2 = await t.throwsAsync(() => stream.return("foo"));
        t.is(error1.name, "AbortError");
        t.is(error2.name, "AbortError");
    },
);

test(
    "abort triggers cleanup",
    async (t) => {
        const abortController = new AbortController();
        let cleanedUp = false;
        const stream = Stream.abortable(abortController.signal, () => {
            return () => {
                cleanedUp = true;
            };
        });

        abortController.abort();
        t.is(cleanedUp, true);
        const error = await t.throwsAsync(() => stream.next());
        t.is(error.name, "AbortError");
    },
);

test(
    "an already aborted signal means the initializer will never run",
    async (t) => {
        const abortController = new AbortController();
        abortController.abort();
        let called: boolean = false;
        const stream = Stream.abortable<number>(abortController.signal, (s) => {
            called = true;
            s.yield(1);
        });
        t.false(called);
        const error = await t.throwsAsync(() => stream.next());
        t.is(error.name, "AbortError");
    },
);
