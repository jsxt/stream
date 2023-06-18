const notResolved = Symbol("notResolved");

/* This tests that a promise is already resolved */
export default async function isResolved(
    promise: Promise<any>,
): Promise<boolean> {
    try {
        await Promise.race([promise, Promise.reject(notResolved)]);
        return true;
    } catch (err: unknown) {
        if (err === notResolved) {
            return false;
        }
        throw err;
    }
}
