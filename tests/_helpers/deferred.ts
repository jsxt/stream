
type Deferred<T> = {
    promise: Promise<T>,
    resolve: (value: T | Promise<T>) => void,
    reject: (error: any) => void,
};

export default function deferred<T=void>(): Deferred<T> {
    let resolve!: Deferred<T>["resolve"];
    let reject!: Deferred<T>["reject"];
    const promise = new Promise<T>((pResolve, pReject) => {
        resolve = pResolve;
        reject = pReject;
    });
    return { promise, resolve, reject };
}
