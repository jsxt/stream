import assert from "node:assert/strict";
import test from "node:test";
import Stream from "../Stream.js";

await test("constructor works and methods exist", (t) => {
    const s = new Stream((stream) => void stream.return());
    assert(typeof s.next === "function");
    assert(typeof s.return === "function");
    assert(typeof s[Symbol.asyncIterator] === "function");
    assert(s instanceof Stream);
});

await test("stream controller methods exist", (t) => {
    // eslint-disable-next-line no-new
    new Stream((stream) => {
        assert(typeof stream.yield === "function");
        assert(typeof stream.throw === "function");
        assert(typeof stream.return === "function");
    });
});

await test("stream controller aliases exist and are the same functions", (t) => {
    // eslint-disable-next-line no-new
    new Stream((stream) => {
        assert(typeof stream.next === "function");
        assert(stream.next === stream.yield);

        assert(typeof stream.error === "function");
        assert(stream.error === stream.throw);

        assert(typeof stream.complete === "function");
        assert(stream.complete === stream.return);
    });
});

await test("Symbol.asyncIterator returns the current stream", async (t) => {
    const s = new Stream((stream) => {
        stream.yield(1);
        stream.yield(2);
    });

    assert(s[Symbol.asyncIterator]() === s);
});
