import Stream from './dist/Stream.js';

const stream = new Stream(stream => {
    stream.throw(new Error("Oh dear!"));

    return () => {
        throw new Error("Oops!");
    }
})

async function main() {
    try {
        await stream.next();
    } catch (err) {
        console.log(err);
    }
    console.log(stream._state);
}

main().catch(console.error);
