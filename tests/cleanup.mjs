import test from "ava"
import Stream from "../Stream.mjs"

test('cleanup is called on ending a sequence early', async t => {
    let cleanedUp = false
    const stream = new Stream(stream => {
        stream.next(10)
        return _ => {
            cleanedUp = true
        }
    })

    t.deepEqual({ done: false, value: 10 }, await stream.next())
    await stream.return()
    t.true(cleanedUp)
})

test.failing("cleanup doesn't happen early if we're still waiting", async t => {
    let cleanedUp = false
    let streamController
    const stream = new Stream(stream => {
        streamController = stream
    })
    // TODO: complete this
})

test('cleanup is called on normal completion of a sequence', async t => {
    let cleanedUp = false
    const stream = new Stream(stream => {
        stream.return(12)
        return _ => {
            cleanedUp = true
        }
    })
    t.deepEqual({ done: true, value: 12 }, await stream.next())
    t.true(cleanedUp)
})
