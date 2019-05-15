class NotResolved extends Error {}

/* This tests that a promise is already resolved */
export default async function isResolved(promise) {
    try {
        await Promise.race([promise, Promise.reject(new NotResolved())])
        return true
    } catch (err) {
        if (err instanceof NotResolved) {
            return false
        } else {
            throw err
        }
    }
}
