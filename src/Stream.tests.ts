import Stream, { StreamController } from "./Stream.js";
import * as assert from "./assert.js";

function queueMicrotask(func: () => any) {
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    Promise.resolve().then(func);
}

export const tests = {
    "can construct a stream"() {
        const stream = new Stream((_stream) => {
            /* do nothing */
        });

        assert.instanceOf(stream, Stream);
    },

    async "can emit values from the stream"() {
        const stream = new Stream<number>((stream) => {
            stream.yield(10);
            stream.yield(20);
        });

        assert.deepEqual({ done: false, value: 10 }, await stream.next());
        assert.deepEqual({ done: false, value: 20 }, await stream.next());
    },

    async "can emit values asynchronously from stream"() {
        const stream = new Stream<number>((stream) => {
            stream.yield(10);
            queueMicrotask(() => stream.yield(20));
        });

        assert.deepEqual({ done: false, value: 10 }, await stream.next());
        assert.deepEqual({ done: false, value: 20 }, await stream.next());
    },

    async "can emit done value"() {
        const stream = new Stream<number, string>((stream) => {
            stream.yield(10);
            stream.yield(20);
            stream.return("foobar");
        });

        assert.deepEqual({ done: false, value: 10 }, await stream.next());
        assert.deepEqual({ done: false, value: 20 }, await stream.next());
        assert.deepEqual({ done: true, value: "foobar" }, await stream.next());
    },

    async "can emit done value asynchronously"() {
        const stream = new Stream<number, string>((stream) => {
            stream.yield(10);
            queueMicrotask(() => {
                stream.yield(20);
                queueMicrotask(() => stream.return("foobar"));
            });
        });

        assert.deepEqual({ done: false, value: 10 }, await stream.next());
        assert.deepEqual({ done: false, value: 20 }, await stream.next());
        assert.deepEqual({ done: true, value: "foobar" }, await stream.next());
    },

    async "can throw error on stream"() {
        class TestError {}

        const stream = new Stream<number>((stream) => {
            stream.yield(10);
            stream.throw(new TestError());
        });

        assert.deepEqual({ done: false, value: 10 }, await stream.next());
        const error = await assert.throwsAsync(() => stream.next());
        assert.instanceOf(error, TestError);
    },

    async "can throw error on stream asynchronously"() {
        class TestError {}

        const stream = new Stream<number>((stream) => {
            stream.yield(10);
            queueMicrotask(() => stream.throw(new TestError()));
        });

        assert.deepEqual({ done: false, value: 10 }, await stream.next());
        const error = await assert.throwsAsync(() => stream.next());
        assert.instanceOf(error, TestError);
    },

    async "can await value not yet arrived"() {
        let streamController!: StreamController<number, undefined>;
        const stream = new Stream<number>((stream) => {
            streamController = stream;
        });

        const nextItem1 = stream.next();
        const nextItem2 = stream.next();

        await assert.notResolved(nextItem1);
        await assert.notResolved(nextItem2);

        streamController.yield(10);

        assert.deepEqual({ done: false, value: 10 }, await nextItem1);
        await assert.notResolved(nextItem2);

        streamController.yield(20);

        assert.deepEqual({ done: false, value: 20 }, await nextItem2);
    },

    async "can await done value not yet arrived"() {
        let streamController!: StreamController<number, string>;
        const stream = new Stream<number, string>((stream) => {
            streamController = stream;
        });

        const nextItem1 = stream.next();
        const nextItem2 = stream.next();

        await assert.notResolved(nextItem1);
        await assert.notResolved(nextItem2);

        streamController.yield(10);

        assert.deepEqual({ done: false, value: 10 }, await nextItem1);
        await assert.notResolved(nextItem2);

        streamController.return("foobar");

        assert.deepEqual({ done: true, value: "foobar" }, await nextItem2);
    },

    async ".return closes the stream"() {
        const stream = new Stream<number, string>((stream) => {
            stream.yield(2);
            queueMicrotask(() => stream.yield(3));
        });

        await stream.next();
        await stream.next();

        assert.deepEqual({ done: true, value: "foobar" }, await stream.return("foobar"));
    },
};
