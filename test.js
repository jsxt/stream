import ReadableStream from "./dist/ReadableStream.js";

const stream = new ReadableStream({
    pull(c) {
        c.enqueue(12);
    }
});

const reader = stream.getReader();
console.log(await reader.read());
