import test from "ava";
import Stream from "../dist/Stream.js";

test("constructor works and methods exist", (t) => {
    const s = new Stream((stream) => stream.return());
    t.true(typeof s.next === "function");
    t.true(typeof s.return === "function");
    t.true(typeof s[Symbol.asyncIterator] === "function");
    t.true(s instanceof Stream);
});

test("stream controller methods exist", (t) => {
    // eslint-disable-next-line no-new
    new Stream((stream) => {
        t.true(typeof stream.yield === "function");
        t.true(typeof stream.throw === "function");
        t.true(typeof stream.return === "function");
    });
});

test("stream controller aliases exist and are the same functions", (t) => {
    // eslint-disable-next-line no-new
    new Stream((stream) => {
        t.true(typeof stream.next === "function");
        t.true(stream.next === stream.yield);

        t.true(typeof stream.error === "function");
        t.true(stream.error === stream.throw);

        t.true(typeof stream.complete === "function");
        t.true(stream.complete === stream.return);
    });
});

test("Symbol.asyncIterator returns the current stream", async (t) => {
    const s = new Stream((stream) => {
        stream.yield(1);
        stream.yield(2);
    });

    t.true(s[Symbol.asyncIterator]() === s);
});
